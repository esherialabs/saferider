import { describe, expect, it } from 'vitest';

import { getEvidenceCompletionStatus, MAX_EVIDENCE_SIZE_BYTES } from '../evidenceUploadPolicy.js';

const SHA256 = 'a'.repeat(64);

describe('evidence upload completion policy', () => {
  it('accepts only an exact declared-size and checksum match', () => {
    expect(getEvidenceCompletionStatus({
      declaredSizeBytes: 12,
      actualSizeBytes: 12,
      expectedSha256: SHA256,
      actualSha256: SHA256.toUpperCase(),
    })).toBe('uploaded');
  });

  it.each([
    { declaredSizeBytes: 12, actualSizeBytes: 13 },
    { declaredSizeBytes: 12, actualSizeBytes: 11 },
    { declaredSizeBytes: null, actualSizeBytes: 12 },
    { declaredSizeBytes: MAX_EVIDENCE_SIZE_BYTES, actualSizeBytes: MAX_EVIDENCE_SIZE_BYTES + 1 },
  ])('rejects undeclared, mismatched, or oversized objects: %j', sizes => {
    expect(getEvidenceCompletionStatus({
      ...sizes,
      expectedSha256: SHA256,
      actualSha256: SHA256,
    })).toBe('rejected');
  });

  it('separately identifies an exact-size checksum mismatch', () => {
    expect(getEvidenceCompletionStatus({
      declaredSizeBytes: 12,
      actualSizeBytes: 12,
      expectedSha256: SHA256,
      actualSha256: 'b'.repeat(64),
    })).toBe('hash_mismatch');
  });
});
