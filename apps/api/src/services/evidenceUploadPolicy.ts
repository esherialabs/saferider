export const MAX_EVIDENCE_SIZE_BYTES = 100 * 1024 * 1024;

export type EvidenceCompletionStatus = 'uploaded' | 'hash_mismatch' | 'rejected';

export function getEvidenceCompletionStatus(params: {
  declaredSizeBytes: number | null;
  actualSizeBytes: number;
  expectedSha256: string | null;
  actualSha256: string;
  maxSizeBytes?: number;
}): EvidenceCompletionStatus {
  const maxSizeBytes = params.maxSizeBytes ?? MAX_EVIDENCE_SIZE_BYTES;
  if (
    params.declaredSizeBytes === null ||
    params.declaredSizeBytes <= 0 ||
    params.actualSizeBytes !== params.declaredSizeBytes ||
    params.actualSizeBytes > maxSizeBytes
  ) {
    return 'rejected';
  }

  if (!params.expectedSha256 || params.expectedSha256.toLowerCase() !== params.actualSha256.toLowerCase()) {
    return 'hash_mismatch';
  }

  return 'uploaded';
}
