import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ getSession: vi.fn() }));
const http = vi.hoisted(() => ({ request: vi.fn(), setAuthToken: vi.fn() }));
vi.mock('../../lib/auth/authClient', () => ({ authClient: auth }));
vi.mock('../../lib/api/httpClient', () => http);

import { fetchRightsRequests, requestSubmittedDataRight } from '../privacyRightsService';

describe('privacy rights client', () => {
  beforeEach(() => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: 'synthetic-token' } }, error: null });
  });

  it('maps visible request status without accepting content payloads', async () => {
    http.request.mockResolvedValue({ requests: [{
      id: 'request-1', request_type: 'access', status: 'requested',
      due_at: '2026-08-29T00:00:00.000Z', created_at: '2026-07-30T00:00:00.000Z',
    }] });
    expect(await fetchRightsRequests()).toEqual([expect.objectContaining({ requestType: 'access', status: 'requested' })]);
    expect(http.request).toHaveBeenCalledWith({ path: '/privacy/dsar' });
  });

  it('submits only the request type and an idempotency key', async () => {
    http.request.mockResolvedValue({ request: {
      id: 'request-1', request_type: 'deletion', status: 'requested',
      due_at: '2026-08-29T00:00:00.000Z', created_at: '2026-07-30T00:00:00.000Z',
    } });
    await requestSubmittedDataRight('deletion');
    expect(http.request).toHaveBeenCalledWith({
      path: '/privacy/dsar', method: 'POST',
      body: { requestType: 'deletion', idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) },
    });
  });

  it('fails before the API when no owned session exists', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(fetchRightsRequests()).rejects.toThrow(/authenticated/);
    expect(http.request).not.toHaveBeenCalled();
  });
});
