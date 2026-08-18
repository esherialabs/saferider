import * as Crypto from 'expo-crypto';

import { request, setAuthToken } from '../lib/api/httpClient';
import { authClient } from '../lib/auth/authClient';

export type SubmittedDataRight = 'access' | 'export' | 'correction' | 'restriction' | 'objection' | 'deletion';
export type RightsRequestStatus = 'requested' | 'verified' | 'executing' | 'completed' | 'partially_completed' | 'failed' | 'legal_hold';
export type RightsRequest = {
  id: string;
  requestType: SubmittedDataRight;
  status: RightsRequestStatus;
  dueAt: Date;
  createdAt: Date;
};

type RightsRequestRow = {
  id: string;
  request_type: SubmittedDataRight;
  status: RightsRequestStatus;
  due_at: string;
  created_at: string;
};

async function requireToken(): Promise<void> {
  const { data, error } = await authClient.getSession();
  const token = error ? null : data.session?.access_token;
  if (!token) throw new Error('Submitted-data rights history requires an authenticated case account.');
  setAuthToken(token);
}

function mapRow(row: RightsRequestRow): RightsRequest {
  return {
    id: row.id,
    requestType: row.request_type,
    status: row.status,
    dueAt: new Date(row.due_at),
    createdAt: new Date(row.created_at),
  };
}

export async function fetchRightsRequests(): Promise<RightsRequest[]> {
  await requireToken();
  const response = await request<{ requests: RightsRequestRow[] }>({ path: '/privacy/dsar' });
  return response.requests.map(mapRow);
}

export async function requestSubmittedDataRight(requestType: SubmittedDataRight): Promise<RightsRequest> {
  await requireToken();
  const response = await request<{ request: RightsRequestRow }>({
    path: '/privacy/dsar',
    method: 'POST',
    body: { requestType, idempotencyKey: Crypto.randomUUID() },
  });
  return mapRow(response.request);
}
