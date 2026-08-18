import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DraftData } from '../../utils/draftStorage';
import { submitApprovedAnonymousSignals } from '../rsiSignalService';

const configMock = vi.hoisted(() => ({ decision: { enabled: false, reason: 'pending', config: {} } as any }));
const httpMock = vi.hoisted(() => ({ request: vi.fn(), setAuthToken: vi.fn() }));
const authMock = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock('../../config/rsi/rsiSignalConfig', () => ({
  getMobileRsiSignalDecision: vi.fn(() => configMock.decision),
}));
vi.mock('../../lib/api/httpClient', () => httpMock);
vi.mock('../../lib/auth/authClient', () => ({ authClient: { getSession: authMock.getSession } }));

const draft: DraftData = {
  id: 'synthetic-draft', createdAt: new Date('2026-07-30'), updatedAt: new Date('2026-07-30'),
  location: { coordinates: { latitude: -1.2864, longitude: 36.8172 } },
  datetime: { date: '2026-07-30', time: '10:37', accuracy: 'approximate' },
  selectedTags: ['harassment'], mediaFiles: [],
};

const approvedConfig = {
  enabled: true, configVersion: 'synthetic-control-v1', policyVersion: 'synthetic-control-v1',
  consentVersion: 'synthetic-consent-v1', areaDefinitionVersion: 'synthetic-area-v1',
  privacyApprovalId: 'synthetic-approval', cellSizeDegrees: 0.05, timeBucketMinutes: 60,
  allowedAreaIds: ['cell-1774-4336'], allowedCategories: ['harassment'],
};
const aggregateConsent = {
  recordId: '11111111-1111-4111-8111-111111111111',
  purpose: 'anonymous_aggregate' as const,
  version: 'synthetic-consent-v1',
  grantedAt: '2026-07-30T10:00:00.000Z',
  ingestionId: '22222222-2222-4222-8222-222222222222',
};

describe('mobile RSI submission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configMock.decision = { enabled: false, reason: 'pending_privacy_review', config: approvedConfig };
    authMock.getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-token' } }, error: null });
  });

  it('fails before auth or network when the evidence-derived capability is disabled', async () => {
    await expect(submitApprovedAnonymousSignals({ draft, aggregateConsent })).rejects.toThrow(/pending_privacy_review/);
    expect(authMock.getSession).not.toHaveBeenCalled();
    expect(httpMock.request).not.toHaveBeenCalled();
  });

  it('requires explicit aggregate consent before auth or network', async () => {
    configMock.decision = { enabled: true, config: approvedConfig };
    await expect(submitApprovedAnonymousSignals({
      draft,
      aggregateConsent: { ...aggregateConsent, purpose: 'pathway_submission' } as any,
    })).rejects.toThrow(/Explicit/);
    expect(authMock.getSession).not.toHaveBeenCalled();
  });

  it('posts consent and only minimized signals in one retry-safe request', async () => {
    configMock.decision = { enabled: true, config: approvedConfig };
    httpMock.request.mockResolvedValueOnce({ accepted: true, count: 1 });
    await expect(submitApprovedAnonymousSignals({ draft, aggregateConsent })).resolves.toEqual({ accepted: true, count: 1 });
    expect(httpMock.setAuthToken).toHaveBeenCalledWith('synthetic-token');
    expect(httpMock.request).toHaveBeenCalledOnce();
    expect(httpMock.request.mock.calls[0][0]).toMatchObject({
      path: '/rsi/signals/batch', method: 'POST',
      body: {
        consent: {
          recordId: aggregateConsent.recordId,
          purpose: 'anonymous_aggregate',
          version: 'synthetic-consent-v1',
        },
        ingestionId: aggregateConsent.ingestionId,
      },
    });
    const payload = httpMock.request.mock.calls[0][0].body;
    expect(payload.signals[0]).toMatchObject({
      area: { type: 'coarse_cell', id: 'cell-1774-4336' }, category: 'harassment',
    });
    expect(JSON.stringify(payload)).not.toContain('synthetic-draft');
    expect(JSON.stringify(payload)).not.toContain('36.8172');
  });
});
