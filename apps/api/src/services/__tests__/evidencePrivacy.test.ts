import { describe, expect, it } from 'vitest';

import type { AttachmentRow } from '../../repositories/caseRepository.js';
import { buildSafeEvidenceMetadata, getEvidenceProcessingErrors } from '../evidenceMetadata.js';
import { getEvidenceDownloadDecision } from '../evidenceQuarantine.js';

function attachment(overrides: Partial<AttachmentRow> = {}): AttachmentRow {
  return {
    id: 'attachment', owner_id: 'owner', draft_id: null, case_id: 'case', bucket: 'bucket', bucket_path: 'object',
    mime_type: 'image/jpeg', size_bytes: 1, sha256: 'a'.repeat(64), expected_sha256: 'a'.repeat(64),
    upload_manifest: {}, retention: {}, retention_policy_id: 'submitted-case-pending-legal-v1',
    antivirus_status: 'clean', quarantine_status: 'released', scan_evidence: {}, status: 'uploaded', metadata: {},
    created_at: '2026-07-30T00:00:00Z', updated_at: '2026-07-30T00:00:00Z',
    ...overrides,
  };
}

describe('evidence truth states and quarantine', () => {
  it('requires complete proof before a transform can be marked processed', () => {
    expect(getEvidenceProcessingErrors(undefined)).toEqual([
      'privacyStatus is required for every evidence upload',
    ]);
    expect(getEvidenceProcessingErrors({ privacyStatus: {} })).toEqual([
      'faceBlur requires an explicit privacy status',
      'metadataRemoval requires an explicit privacy status',
      'fileEncryption requires an explicit privacy status',
    ]);
    expect(getEvidenceProcessingErrors({ privacyStatus: { fileEncryption: { status: 'requested' } } })).toEqual(expect.arrayContaining([
      expect.stringContaining('upload requires'),
    ]));
    expect(getEvidenceProcessingErrors({ privacyStatus: { faceBlur: { status: 'processed' } } }, { allowProcessedClaims: true })).toEqual(expect.arrayContaining([
      expect.stringContaining('preview'), expect.stringContaining('confidence'), expect.stringContaining('confirmation'), expect.stringContaining('preservation'),
    ]));
    const metadata = {
      displayName: 'evidence-photo.jpg', mediaType: 'photo',
      privacyStatus: {
        faceBlur: { status: 'processed', previewGenerated: true, confidence: 0.91, userConfirmed: true, originalPreserved: true },
        metadataRemoval: { status: 'processed', verifiedFileType: 'image/jpeg', verificationMethod: 'before_after_metadata_diff' },
        fileEncryption: { status: 'processed', algorithm: 'AES-256-GCM', keyManagement: 'recipient_envelope', sharingModel: 'recipient_wrapped_key', keyReference: 'key-ref-1' },
      },
    };
    expect(getEvidenceProcessingErrors(metadata)).toEqual(expect.arrayContaining([
      expect.stringContaining('disabled pending device and security approval'),
    ]));
    expect(getEvidenceProcessingErrors(metadata, { allowProcessedClaims: true })).toEqual([]);
    expect(buildSafeEvidenceMetadata(metadata, 'image/jpeg')).toMatchObject({ privacyStatus: metadata.privacyStatus });
  });

  it.each([
    [{ status: 'pending_upload' }, 'not_uploaded'],
    [{ status: 'hash_mismatch' }, 'hash_mismatch'],
    [{ sha256: null }, 'hash_missing'],
    [{ expected_sha256: null }, 'hash_missing'],
    [{ expected_sha256: 'b'.repeat(64) }, 'hash_mismatch'],
    [{ antivirus_status: 'pending' }, 'unscanned'],
    [{ antivirus_status: 'rejected' }, 'scan_rejected'],
    [{ quarantine_status: 'quarantined' }, 'quarantined'],
  ] as Array<[Partial<AttachmentRow>, string]>)('blocks unsafe download state %#', (overrides, reason) => {
    expect(getEvidenceDownloadDecision(attachment(overrides))).toEqual({ allowed: false, reason });
  });

  it('allows only uploaded, hash-verified, clean, released evidence', () => {
    expect(getEvidenceDownloadDecision(attachment())).toEqual({ allowed: true });
  });
});
