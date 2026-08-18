import fs from 'node:fs';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  CaseTimelineExportError,
  buildPublicSafeCaseTimelineExport,
  caseExportControls,
  evaluateProtectedCaseExportGate,
} from '../caseTimelineExport';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

function input() {
  return {
    caseId: 'private-case-id-123',
    state: 'provider_pending',
    events: [
      {
        eventId: 'event-2',
        eventType: 'provider_pending',
        timestamp: '2026-07-30T10:00:00.000Z',
        state: 'provider_pending',
        summaryCode: 'provider.pending',
        attachmentIds: ['attachment-private-2'],
      },
      {
        eventId: 'event-1',
        eventType: 'submitted',
        timestamp: '2026-07-30T09:00:00.000Z',
        state: 'submitted',
        summaryCode: 'case.submitted',
        attachmentIds: ['attachment-private-1'],
      },
    ],
    attachments: [
      {
        attachmentId: 'attachment-private-1',
        type: 'photo',
        mimeCategory: 'image',
        sizeBytes: 1200,
        evidenceSha256: HASH_A,
        status: 'verified',
      },
      {
        attachmentId: 'attachment-private-2',
        type: 'audio',
        mimeCategory: 'audio',
        sizeBytes: 2400,
        evidenceSha256: HASH_B,
        status: 'quarantined',
      },
    ],
  } as const;
}

const options = {
  exportSalt: 'synthetic-export-salt-000000000001',
  generatedAt: '2026-07-30T12:00:00.000Z',
};

describe('public-safe case timeline export', () => {
  it('builds a schema-valid chronological export with pseudonymous identifiers and hash references', () => {
    const output = buildPublicSafeCaseTimelineExport(input(), options);
    const schema = JSON.parse(fs.readFileSync(new URL('../../../schemas/public-safe-case-timeline-export.schema.json', import.meta.url), 'utf8'));
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

    expect(validate(output), JSON.stringify(validate.errors)).toBe(true);
    expect(output.events.map(event => event.summaryCode)).toEqual(['case.submitted', 'provider.pending']);
    expect(output.events[0].evidenceHashRefs).toEqual([HASH_A]);
    expect(output.case).toMatchObject({ state: 'provider_pending', providerReceiptStatus: 'not_confirmed' });
    expect(output.exportMetadata).toMatchObject({ protectedExportEnabled: false, providerReceiptClaimed: false });
  });

  it('does not expose raw case, event, attachment, storage, location, narrative, contact, or file identifiers', () => {
    const output = buildPublicSafeCaseTimelineExport(input(), options);
    const serialized = JSON.stringify({ ...output, limitations: [] });
    for (const forbidden of ['private-case-id-123', 'event-1', 'event-2', 'attachment-private', 'storageKey', 'location', 'narrative', 'providerContact', 'fileName']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('uses a per-export salt so the same private identifier is not linkable between exports', () => {
    const first = buildPublicSafeCaseTimelineExport(input(), options);
    const second = buildPublicSafeCaseTimelineExport(input(), {
      ...options,
      exportSalt: 'synthetic-export-salt-000000000002',
    });
    expect(first.case.anonymizedId).not.toBe(second.case.anonymizedId);
    expect(first.attachments[0].anonymizedId).not.toBe(second.attachments[0].anonymizedId);
  });

  it('rejects minimized inputs containing forbidden narrative or storage fields', () => {
    expect(() => buildPublicSafeCaseTimelineExport({ ...input(), narrative: 'synthetic but forbidden' }, options))
      .toThrowError(expect.objectContaining({ code: 'unsafe_field' }));
    expect(() => buildPublicSafeCaseTimelineExport({ ...input(), storageKey: 'bucket/object' }, options))
      .toThrowError(expect.objectContaining({ code: 'unsafe_field' }));
  });

  it('rejects unknown attachment references, duplicates, malformed hashes, timestamps, and weak salts', () => {
    const missing = input();
    expect(() => buildPublicSafeCaseTimelineExport({
      ...missing,
      events: [{ ...missing.events[0], attachmentIds: ['missing'] }],
    }, options)).toThrowError(expect.objectContaining({ code: 'missing_attachment_reference' }));

    expect(() => buildPublicSafeCaseTimelineExport({
      ...input(),
      events: [input().events[0], input().events[0]],
    }, options)).toThrowError(expect.objectContaining({ code: 'duplicate_identifier' }));

    expect(() => buildPublicSafeCaseTimelineExport({
      ...input(),
      attachments: [{ ...input().attachments[0], evidenceSha256: 'not-a-hash' }],
      events: [{ ...input().events[0], attachmentIds: ['attachment-private-1'] }],
    }, options)).toThrowError(expect.objectContaining({ code: 'invalid_input' }));

    expect(() => buildPublicSafeCaseTimelineExport(input(), { ...options, generatedAt: '2026-07-30T12:00:00+03:00' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_input' }));
    expect(() => buildPublicSafeCaseTimelineExport(input(), { ...options, exportSalt: 'short' }))
      .toThrowError(expect.objectContaining({ code: 'invalid_input' }));
  });

  it('keeps protected file export disabled even when repository-only tests are green', () => {
    expect(caseExportControls).toMatchObject({
      status: 'blocked_external_evidence',
      publicSafeTimeline: { fileWriteEnabled: false, shareEnabled: false },
      protectedExport: { enabled: false },
    });
    expect(evaluateProtectedCaseExportGate({
      authenticatedEncryptionVerified: true,
      cleanupVerified: true,
      independentPrivacyReviewApproved: true,
    })).toMatchObject({ enabled: false });
  });

  it('requires every exact-build gate even under a synthetic approved-control fixture', () => {
    const approvedControls = {
      ...caseExportControls,
      status: 'approved' as const,
      protectedExport: {
        ...caseExportControls.protectedExport,
        enabled: true,
        authenticatedEncryption: 'verified' as const,
        cleanup: 'verified' as const,
        independentPrivacyReview: 'approved' as const,
      },
    };
    expect(evaluateProtectedCaseExportGate({
      authenticatedEncryptionVerified: true,
      cleanupVerified: false,
      independentPrivacyReviewApproved: true,
    }, approvedControls)).toMatchObject({ enabled: false, blockers: [expect.stringContaining('cleanup')] });
    expect(evaluateProtectedCaseExportGate({
      authenticatedEncryptionVerified: true,
      cleanupVerified: true,
      independentPrivacyReviewApproved: true,
    }, approvedControls)).toEqual({ enabled: true, blockers: [] });
  });

  it('uses bounded privacy-safe failures rather than echoing rejected payloads', () => {
    try {
      buildPublicSafeCaseTimelineExport({ ...input(), transcript: 'private synthetic marker' }, options);
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(CaseTimelineExportError);
      expect((error as Error).message).not.toContain('private synthetic marker');
    }
  });
});
