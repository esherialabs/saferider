import { describe, expect, it } from 'vitest';

import {
  buildEvidenceVaultItem,
  buildEvidenceVaultSummary,
  getEvidenceCaptureSourceLabel,
  getEvidenceVaultMediaTypeFromPickerAsset,
  getEvidenceVaultUploadIncludedForDraft,
} from '../evidenceVaultStatus';

describe('evidence vault status model', () => {
  it('builds a truthful status model for a saved audio evidence item', () => {
    const item = buildEvidenceVaultItem(
      {
        id: 'audio-1',
        type: 'audio',
        uri: 'file:///drafts/audio-1.m4a',
        fileName: 'audio-1.m4a',
        size: 2048,
        timestamp: new Date('2026-06-06T06:00:00.000Z'),
        captureSource: 'microphone',
        checksum: 'abcdef1234567890fedcba',
        transcript: 'Driver shouted at me after I asked to exit.',
        description: 'Recorded after the ride ended.',
        uploadStatus: 'pending',
      },
      0,
      {
        privacySettings: {
          blurFaces: true,
          removeMetadata: true,
          encryptFiles: true,
        },
        isOnline: true,
      },
    );

    expect(item).toMatchObject({
      title: 'audio-1.m4a',
      typeLabel: 'Audio',
      sourceLabel: 'Microphone recording',
      localStatus: { label: 'Local saved', status: 'processed' },
      uploadStatus: { label: 'Upload pending', status: 'requested' },
      integrityStatus: { label: 'Hash recorded', status: 'processed' },
      transcriptionStatus: { label: 'Transcript saved', status: 'processed' },
      note: 'Recorded after the ride ended.',
    });
    expect(item.privacyItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Blur unavailable', status: 'unavailable' }),
      expect.objectContaining({ label: 'Metadata requested', status: 'requested' }),
      expect.objectContaining({ label: 'Encrypt requested', status: 'requested' }),
    ]));
  });

  it('shows queued/offline evidence without claiming upload or processing completed', () => {
    const queuedItem = buildEvidenceVaultItem(
      {
        id: 'photo-1',
        type: 'photo',
        uri: 'file:///drafts/photo.jpg',
        fileName: 'photo.jpg',
        size: 0,
        captureSource: 'camera',
        uploadStatus: 'pending',
      },
      0,
      {
        privacySettings: {
          blurFaces: true,
          removeMetadata: true,
          encryptFiles: false,
        },
        draftStatus: 'queued',
        isOnline: false,
      },
    );
    const offlineDraftItem = buildEvidenceVaultItem(
      {
        id: 'photo-2',
        type: 'photo',
        uri: 'file:///drafts/photo-2.jpg',
        fileName: 'photo-2.jpg',
        size: 0,
        captureSource: 'camera',
        uploadStatus: 'pending',
      },
      1,
      {
        privacySettings: {
          blurFaces: false,
          removeMetadata: false,
          encryptFiles: false,
        },
        draftStatus: 'draft',
        isOnline: false,
      },
    );

    expect(queuedItem.uploadStatus).toMatchObject({
      label: 'Queued with draft',
      status: 'requested',
    });
    expect(offlineDraftItem.uploadStatus).toMatchObject({
      label: 'Waiting for connection',
      status: 'requested',
    });
    expect(queuedItem.integrityStatus).toMatchObject({
      label: 'Hash unavailable',
      status: 'unavailable',
    });
    expect(queuedItem.privacyItems).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Blur requested', status: 'requested' }),
      expect.objectContaining({ label: 'Metadata requested', status: 'requested' }),
      expect.objectContaining({ label: 'Encrypt not requested', status: 'not_requested' }),
    ]));
  });

  it('summarizes uploaded, failed, queued, transcript, notes, and privacy request counts', () => {
    const summary = buildEvidenceVaultSummary(
      [
        {
          id: 'photo-1',
          type: 'photo',
          uri: 'file:///photo.jpg',
          uploadStatus: 'uploaded',
          transcript: '',
          description: 'Visible plate.',
        },
        {
          id: 'audio-1',
          type: 'audio',
          uri: 'file:///audio.m4a',
          uploadStatus: 'failed',
          uploadError: 'network_error',
          transcript: 'Saved transcript.',
        },
        {
          id: 'doc-1',
          type: 'document',
          uri: 'file:///doc.pdf',
          uploadStatus: 'pending',
        },
      ],
      {
        privacySettings: {
          blurFaces: true,
          removeMetadata: false,
          encryptFiles: false,
        },
        draftStatus: 'queued',
      },
    );

    expect(summary).toEqual({
      total: 3,
      localOnly: 2,
      queued: 1,
      uploaded: 1,
      failed: 1,
      privacyRequested: 3,
      transcriptsSaved: 1,
      notesSaved: 1,
    });
  });

  it('shows excluded upload status without queued counts for private, anonymous-map, and no-brief referral drafts', () => {
    const media = {
      id: 'photo-1',
      type: 'photo' as const,
      uri: 'file:///photo.jpg',
      uploadStatus: 'pending' as const,
    };
    const savePrivateUploadIncluded = getEvidenceVaultUploadIncludedForDraft({
      selectedPathway: 'save-private',
    });
    const referralUploadIncluded = getEvidenceVaultUploadIncludedForDraft({
      selectedPathway: 'referral',
      includeBrief: false,
    });
    const referralSelectionUploadIncluded = getEvidenceVaultUploadIncludedForDraft({
      selectedPathway: 'referral',
      includeBrief: true,
      referralSelection: { includeBrief: false },
    });

    expect(savePrivateUploadIncluded).toBe(false);
    expect(referralUploadIncluded).toBe(false);
    expect(referralSelectionUploadIncluded).toBe(false);
    expect(getEvidenceVaultUploadIncludedForDraft({ selectedPathway: 'anonymous-map' })).toBe(false);
    expect(getEvidenceVaultUploadIncludedForDraft({ selectedPathway: 'escalate' })).toBe(true);

    const savePrivateItem = buildEvidenceVaultItem(media, 0, {
      draftStatus: 'queued',
      isOnline: false,
      uploadIncluded: savePrivateUploadIncluded,
    });
    const referralSummary = buildEvidenceVaultSummary([media], {
      draftStatus: 'queued',
      isOnline: false,
      uploadIncluded: referralUploadIncluded,
    });

    expect(savePrivateItem.uploadStatus).toMatchObject({
      label: 'Upload not included',
      status: 'not_requested',
    });
    expect(referralSummary).toMatchObject({
      total: 1,
      localOnly: 1,
      queued: 0,
      uploaded: 0,
      failed: 0,
    });
  });

  it('does not count offline draft evidence as queued before the draft is actually queued', () => {
    const summary = buildEvidenceVaultSummary(
      [
        {
          id: 'photo-1',
          type: 'photo',
          uri: 'file:///photo.jpg',
          uploadStatus: 'pending',
        },
      ],
      {
        draftStatus: 'draft',
        isOnline: false,
      },
    );

    expect(summary).toMatchObject({
      total: 1,
      localOnly: 1,
      queued: 0,
      uploaded: 0,
      failed: 0,
    });
  });

  it('keeps image picker video assets typed as video for screenshot imports', () => {
    expect(getEvidenceVaultMediaTypeFromPickerAsset({ type: 'video' })).toBe('video');
    expect(getEvidenceVaultMediaTypeFromPickerAsset({ mimeType: 'video/mp4' })).toBe('video');
    expect(getEvidenceVaultMediaTypeFromPickerAsset({ type: 'image', mimeType: 'image/png' })).toBe('photo');
  });

  it('does not invent capture source labels for legacy media without a saved source field', () => {
    expect(getEvidenceCaptureSourceLabel({ type: 'photo' })).toBe('Saved evidence');
    expect(getEvidenceCaptureSourceLabel({ type: 'video' })).toBe('Saved evidence');
    expect(getEvidenceCaptureSourceLabel({ type: 'document' })).toBe('Saved evidence');
    expect(getEvidenceCaptureSourceLabel({ type: 'audio' })).toBe('Saved evidence');
    expect(getEvidenceCaptureSourceLabel({ type: 'photo', captureSource: 'camera' })).toBe('Camera capture');
    expect(getEvidenceCaptureSourceLabel({ type: 'document', captureSource: 'document_picker' })).toBe('Document picker');
    expect(getEvidenceCaptureSourceLabel({ type: 'photo', isFromStealth: true })).toBe('Stealth trigger');
  });
});
