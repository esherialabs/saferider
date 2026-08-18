import { getRsiCapabilityDecision } from '../config/rsiControls.js';
import { isPrivacyCapabilityEnabled } from '../config/privacyControls.js';
import { deleteExpiredAnonymousRsiSignals } from '../repositories/rsiRepository.js';
import { auditEvent } from './auditService.js';

export async function executeApprovedRsiRetention(now = new Date()): Promise<{ deletedCount: number }> {
  const decision = getRsiCapabilityDecision('retentionExecution', now);
  if (!decision.enabled) {
    throw new Error(`RSI retention execution is disabled: ${decision.reason}`);
  }
  if (
    !isPrivacyCapabilityEnabled('server_retention_execution') ||
    decision.controls.rawSignalRetention.status !== 'approved' ||
    !decision.controls.rawSignalRetention.durationDays
  ) {
    throw new Error('RSI retention execution lacks approved legal retention controls');
  }
  const deletedCount = await deleteExpiredAnonymousRsiSignals(now);
  await auditEvent({
    action: 'rsi.signal.retention.delete',
    resourceClass: 'anonymous_aggregate_signal',
    outcome: 'success',
    policyVersion: decision.controls.controlVersion,
  });
  return { deletedCount };
}
