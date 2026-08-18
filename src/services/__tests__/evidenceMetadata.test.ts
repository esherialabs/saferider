import { describe, expect, it } from 'vitest';

import { buildSafeEvidenceMetadata } from '../../../apps/api/src/services/evidenceMetadata';

const SAFE_PACKET_STATUS = 'File name and checksum withheld from packet metadata';
const SAFE_PRIVACY_REQUEST = 'Metadata removal was requested, but raw evidence files are not stripped before local storage.';

describe('API evidence metadata sanitizer', () => {
  it('drops hostile client-provided packet status and privacy request strings', () => {
    const metadata = buildSafeEvidenceMetadata({
      displayName: 'Mary-Jones-KDD-123A.jpg',
      mediaType: 'photo',
      packetRedactionLevel: 'heavy',
      packetMetadataStatus: 'Mary Jones called +254712345678 near River Road from /local/path/photo.jpg',
      privacyRequests: [
        SAFE_PRIVACY_REQUEST,
        'Call Mary Jones at +254712345678 near River Road',
        'file:///local/path/photo.jpg',
      ],
      privacyStatus: {
        faceBlur: {
          status: 'requested',
          reason: 'Mary Jones requested blur at River Road',
        },
      },
    }, 'image/jpeg');

    expect(metadata).toEqual({
      displayName: 'evidence-photo.jpg',
      mediaType: 'photo',
      packetRedactionLevel: 'heavy',
      privacyRequests: [SAFE_PRIVACY_REQUEST],
      privacyStatus: {
        faceBlur: { status: 'requested' },
      },
    });
    expect(metadata).not.toHaveProperty('packetMetadataStatus');
    expect(JSON.stringify(metadata)).not.toContain('Mary Jones');
    expect(JSON.stringify(metadata)).not.toContain('+254712345678');
    expect(JSON.stringify(metadata)).not.toContain('River Road');
    expect(JSON.stringify(metadata)).not.toContain('/local/path');
  });

  it('preserves only exact server-known packet metadata labels', () => {
    const metadata = buildSafeEvidenceMetadata({
      displayName: 'evidence-photo-1.jpg',
      mediaType: 'photo',
      packetRedactionLevel: 'light',
      packetMetadataStatus: SAFE_PACKET_STATUS,
      privacyRequests: [SAFE_PRIVACY_REQUEST, SAFE_PRIVACY_REQUEST],
    }, 'image/jpeg');

    expect(metadata).toMatchObject({
      displayName: 'evidence-photo.jpg',
      mediaType: 'photo',
      packetRedactionLevel: 'light',
      packetMetadataStatus: SAFE_PACKET_STATUS,
      privacyRequests: [SAFE_PRIVACY_REQUEST],
    });
  });

  it('derives client display name extensions from MIME type or a strict safe fallback', () => {
    expect(buildSafeEvidenceMetadata({
      displayName: 'evidence-photo-1.mary',
      mediaType: 'photo',
    }, 'image/jpeg')).toMatchObject({
      displayName: 'evidence-photo.jpg',
      mediaType: 'photo',
    });

    expect(buildSafeEvidenceMetadata({
      displayName: 'evidence-photo-1.2547',
      mediaType: 'photo',
    }, 'application/octet-stream')).toMatchObject({
      displayName: 'evidence-photo',
      mediaType: 'photo',
    });

    expect(buildSafeEvidenceMetadata({
      displayName: 'evidence-document-2.pdf',
      mediaType: 'document',
    }, 'application/octet-stream')).toMatchObject({
      displayName: 'evidence-document.pdf',
      mediaType: 'document',
    });

    const serialized = JSON.stringify([
      buildSafeEvidenceMetadata({ displayName: 'evidence-photo-1.mary', mediaType: 'photo' }, 'image/jpeg'),
      buildSafeEvidenceMetadata({ displayName: 'evidence-photo-1.river', mediaType: 'photo' }, 'application/octet-stream'),
      buildSafeEvidenceMetadata({ displayName: 'evidence-photo-1.2547', mediaType: 'photo' }, 'application/octet-stream'),
    ]);

    expect(serialized).not.toContain('mary');
    expect(serialized).not.toContain('river');
    expect(serialized).not.toContain('2547');
  });

  it('drops client-provided numeric display name indexes', () => {
    expect(buildSafeEvidenceMetadata({
      displayName: 'evidence-photo-254712345678.jpg',
      mediaType: 'photo',
    }, 'image/jpeg')).toMatchObject({
      displayName: 'evidence-photo.jpg',
      mediaType: 'photo',
    });

    expect(buildSafeEvidenceMetadata({
      displayName: 'evidence-document-254712345678.pdf',
      mediaType: 'document',
    }, 'application/octet-stream')).toMatchObject({
      displayName: 'evidence-document.pdf',
      mediaType: 'document',
    });

    const serialized = JSON.stringify([
      buildSafeEvidenceMetadata({ displayName: 'evidence-photo-254712345678.jpg', mediaType: 'photo' }, 'image/jpeg'),
      buildSafeEvidenceMetadata({ displayName: 'evidence-document-254712345678.pdf', mediaType: 'document' }, 'application/octet-stream'),
    ]);

    expect(serialized).not.toContain('254712345678');
  });
});
