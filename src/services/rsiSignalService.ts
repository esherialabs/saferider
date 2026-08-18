import { getMobileRsiSignalDecision } from '../config/rsi/rsiSignalConfig';
import { request, setAuthToken } from '../lib/api/httpClient';
import { authClient } from '../lib/auth/authClient';
import { buildAnonymousSignals } from '../utils/anonymousSignal';
import type { AnonymousAggregateConsentCheckpoint } from '../utils/consentLedger';
import type { DraftData } from '../utils/draftStorage';

async function requireOwnedApiToken(): Promise<void> {
  const { data, error } = await authClient.getSession();
  const token = error ? null : data.session?.access_token ?? null;
  if (!token) throw new Error('User is not authenticated');
  setAuthToken(token);
}

export async function submitApprovedAnonymousSignals(params: {
  draft: DraftData;
  aggregateConsent: AnonymousAggregateConsentCheckpoint;
}): Promise<{ accepted: true; count: number }> {
  const decision = getMobileRsiSignalDecision();
  if (!decision.enabled) {
    throw new Error(`Anonymous signal ingestion is unavailable: ${decision.reason}`);
  }
  if (
    params.aggregateConsent.purpose !== 'anonymous_aggregate' ||
    params.aggregateConsent.version !== decision.config.consentVersion
  ) {
    throw new Error('Explicit anonymous aggregate consent is required before sharing.');
  }
  const signals = buildAnonymousSignals(params.draft, decision.config);
  await requireOwnedApiToken();
  const result = await request<{ accepted: true; count: number }>({
    path: '/rsi/signals/batch',
    method: 'POST',
    body: {
      consent: {
        recordId: params.aggregateConsent.recordId,
        purpose: params.aggregateConsent.purpose,
        version: params.aggregateConsent.version,
      },
      ingestionId: params.aggregateConsent.ingestionId,
      signals,
    },
  });
  if (result.accepted !== true || result.count !== signals.length) {
    throw new Error('Anonymous signal service returned an invalid acknowledgement.');
  }
  return result;
}
