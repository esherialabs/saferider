import type { AttachmentRow } from '../repositories/caseRepository.js';

export type EvidenceDownloadDecision =
  | { allowed: true }
  | { allowed: false; reason: 'not_uploaded' | 'hash_missing' | 'hash_mismatch' | 'unscanned' | 'scan_rejected' | 'quarantined' };

export function getEvidenceDownloadDecision(attachment: AttachmentRow): EvidenceDownloadDecision {
  if (attachment.status === 'hash_mismatch') return { allowed: false, reason: 'hash_mismatch' };
  if (attachment.status !== 'uploaded') return { allowed: false, reason: 'not_uploaded' };
  if (
    !attachment.sha256 ||
    !attachment.expected_sha256 ||
    !/^[a-f0-9]{64}$/i.test(attachment.sha256) ||
    !/^[a-f0-9]{64}$/i.test(attachment.expected_sha256)
  ) {
    return { allowed: false, reason: 'hash_missing' };
  }
  if (attachment.sha256.toLowerCase() !== attachment.expected_sha256.toLowerCase()) {
    return { allowed: false, reason: 'hash_mismatch' };
  }
  if (attachment.antivirus_status !== 'clean') {
    return {
      allowed: false,
      reason: attachment.antivirus_status === 'rejected' ? 'scan_rejected' : 'unscanned',
    };
  }
  if (attachment.quarantine_status !== 'released') return { allowed: false, reason: 'quarantined' };
  return { allowed: true };
}
