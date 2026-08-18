import { request, setAuthToken } from '../lib/api/httpClient';
import { authClient } from '../lib/auth/authClient';
import {
  confirmRemoteConsentWithdrawal,
  type ConsentLedgerEntry,
  withdrawConsent as withdrawLocalConsent,
} from '../utils/consentLedger';

export class RemoteConsentWithdrawalPendingError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super('Local future processing is stopped, but remote withdrawal is not yet confirmed.');
    this.name = 'RemoteConsentWithdrawalPendingError';
    this.cause = cause;
  }
}

async function requireOwnedApiToken(): Promise<void> {
  const { data, error } = await authClient.getSession();
  const token = error ? null : data.session?.access_token ?? null;
  if (!token) throw new Error('User is not authenticated');
  setAuthToken(token);
}

export async function withdrawConsentForFutureProcessing(
  consentId: string,
): Promise<{ consent: ConsentLedgerEntry; remote: 'not_applicable' | 'confirmed' }> {
  const local = await withdrawLocalConsent(consentId);
  if (local.purpose !== 'anonymous_aggregate') {
    return { consent: local, remote: 'not_applicable' };
  }
  if (local.remoteWithdrawalStatus === 'confirmed') {
    return { consent: local, remote: 'confirmed' };
  }

  try {
    await requireOwnedApiToken();
    const result = await request<{ withdrawal?: { status?: string } }>({
      path: `/privacy/consents/${encodeURIComponent(consentId)}/withdraw`,
      method: 'POST',
    });
    if (result.withdrawal?.status !== 'withdrawn') {
      throw new Error('Consent service returned an invalid withdrawal acknowledgement.');
    }
    const confirmed = await confirmRemoteConsentWithdrawal(consentId);
    return { consent: confirmed, remote: 'confirmed' };
  } catch (error) {
    throw new RemoteConsentWithdrawalPendingError(error);
  }
}
