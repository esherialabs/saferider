import { describe, expect, it } from 'vitest';

import {
  buildEvidencePrivacyManifest,
  buildEvidencePrivacyStatus,
  normalizeMediaPrivacyStatuses,
  resolveEvidencePrivacySettingsForDraft,
  summarizeEvidencePrivacyForConsent,
} from '../evidencePrivacyStatus';

describe('evidence privacy status model', () => {
  it('resolves missing draft privacy settings to safe legacy defaults', () => {
    expect(resolveEvidencePrivacySettingsForDraft(undefined)).toEqual({
      blurFaces: false,
      removeMetadata: false,
      encryptFiles: false,
    });

    expect(resolveEvidencePrivacySettingsForDraft({ blurFaces: true })).toEqual({
      blurFaces: true,
      removeMetadata: false,
      encryptFiles: false,
    });
  });

  it('defaults older media to safe not-requested statuses when no privacy settings exist', () => {
    const status = buildEvidencePrivacyStatus({
      id: 'media-1',
      type: 'photo',
    });

    expect(status.faceBlur.status).toBe('not_requested');
    expect(status.metadataRemoval.status).toBe('not_requested');
    expect(status.fileEncryption.status).toBe('not_requested');
  });

  it('records requested processing without claiming unsupported transformations completed', () => {
    const status = buildEvidencePrivacyStatus(
      {
        id: 'media-1',
        type: 'photo',
      },
      {
        blurFaces: true,
        removeMetadata: true,
        encryptFiles: true,
      },
    );

    expect(status.faceBlur).toMatchObject({
      status: 'requested',
      reason: expect.stringContaining('does not transform'),
    });
    expect(status.metadataRemoval).toMatchObject({
      status: 'requested',
      reason: expect.stringContaining('not stripped'),
    });
    expect(status.fileEncryption).toMatchObject({
      status: 'requested',
      reason: expect.stringContaining('not file-encrypted'),
    });
  });

  it('marks face blur unavailable for non-visual evidence while preserving other requests', () => {
    const [document] = normalizeMediaPrivacyStatuses(
      [
        {
          id: 'doc-1',
          type: 'document' as const,
          uri: 'file:///evidence/report.pdf',
        },
      ],
      {
        blurFaces: true,
        removeMetadata: true,
        encryptFiles: false,
      },
    )!;

    expect(document.privacyStatus.faceBlur.status).toBe('unavailable');
    expect(document.privacyStatus.metadataRemoval.status).toBe('requested');
    expect(document.privacyStatus.fileEncryption.status).toBe('not_requested');
  });

  it('uses the same status details in consent/export manifests', () => {
    const media = [
      {
        id: 'photo-1',
        type: 'photo' as const,
        uri: 'file:///photo.jpg',
        uploadStatus: 'failed' as const,
        uploadError: 'network_error',
      },
    ];
    const settings = {
      blurFaces: true,
      removeMetadata: true,
      encryptFiles: true,
    };

    const consentDetails = summarizeEvidencePrivacyForConsent(media, settings);
    const manifest = buildEvidencePrivacyManifest(media, settings);

    expect(consentDetails[0]).toContain('Blur requested');
    expect(consentDetails[0]).toContain('Upload failed');
    expect(manifest[0].privacyStatus.faceBlur.status).toBe('requested');
    expect(manifest[0].uploadStatus.status).toBe('failed');
  });
});
