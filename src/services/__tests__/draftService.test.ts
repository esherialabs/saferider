import { beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

const httpMock = vi.hoisted(() => ({
  request: vi.fn(),
  setAuthToken: vi.fn(),
}));

const queueMock = vi.hoisted(() => ({
  addToSyncQueue: vi.fn(),
  getSyncQueueItems: vi.fn(),
  removeQueueItemsForDraft: vi.fn(),
}));

vi.mock('../../lib/auth/authClient', () => ({
  authClient: authMock,
}));

vi.mock('../../lib/api/httpClient', () => ({
  request: httpMock.request,
  setAuthToken: httpMock.setAuthToken,
}));

vi.mock('../../utils/offlineSync', () => ({
  offlineSyncManager: queueMock,
}));

import { DraftData, draftStorage } from '../../utils/draftStorage';
import { deleteDraft, fetchDrafts, getDraftById, saveDraft } from '../draftService';

function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    id: 'draft-service-1',
    createdAt: new Date('2026-06-01T08:00:00.000Z'),
    updatedAt: new Date('2026-06-01T08:00:00.000Z'),
    incidentDescription: 'Conductor followed me after I got off the bus.',
    impactLevel: 'medium',
    selectedTags: ['stalking'],
    mediaFiles: [
      {
        id: 'audio-1',
        type: 'audio',
        uri: 'file:///evidence/audio.m4a',
        fileName: 'audio.m4a',
        size: 4096,
        timestamp: new Date('2026-06-01T08:03:00.000Z'),
      },
    ],
    ...overrides,
  };
}

function expectNoRemoteDraftWork() {
  expect(authMock.getSession).not.toHaveBeenCalled();
  expect(httpMock.setAuthToken).not.toHaveBeenCalled();
  expect(httpMock.request).not.toHaveBeenCalled();
  expect(queueMock.addToSyncQueue).not.toHaveBeenCalled();
  expect(queueMock.removeQueueItemsForDraft).not.toHaveBeenCalled();
}

describe('draftService local-only behavior', () => {
  beforeEach(() => {
    authMock.getSession.mockReset();
    authMock.getSession.mockResolvedValue({ data: { session: null }, error: null });
    queueMock.addToSyncQueue.mockReset();
    queueMock.getSyncQueueItems.mockReset();
    queueMock.removeQueueItemsForDraft.mockReset();
    queueMock.addToSyncQueue.mockResolvedValue(undefined);
    queueMock.getSyncQueueItems.mockReturnValue([]);
    queueMock.removeQueueItemsForDraft.mockResolvedValue(0);
    httpMock.request.mockReset();
    httpMock.setAuthToken.mockReset();
  });

  it('saves locally and ignores remote sync flags', async () => {
    const draft = buildDraft({ id: 'draft-save-local-only' });

    const saved = await saveDraft(draft, { syncRemote: true, enqueueSync: true });
    const local = await draftStorage.getDraft(draft.id);

    expect(saved).toMatchObject({
      id: draft.id,
      incidentDescription: draft.incidentDescription,
      impactLevel: 'medium',
    });
    expect(local?.incidentDescription).toBe(draft.incidentDescription);
    expectNoRemoteDraftWork();
  });

  it('returns local drafts even when a remote refresh is requested', async () => {
    const draft = buildDraft({ id: 'draft-local-default' });
    await draftStorage.saveDraft(draft);

    authMock.getSession.mockResolvedValue({
      data: { session: { access_token: 'owned-api-token' } },
      error: null,
    });
    httpMock.request.mockResolvedValue({ drafts: [] });

    const drafts = await fetchDrafts({ forceRemote: true });

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ id: draft.id });
    expectNoRemoteDraftWork();
  });

  it('loads a draft by id from local storage even when remote lookup is requested', async () => {
    const draft = buildDraft({
      id: 'draft-local-detail',
      incidentDescription: 'In-progress report stays on this device.',
    });
    await draftStorage.saveDraft(draft);

    const loaded = await getDraftById(draft.id, { forceRemote: true });

    expect(loaded).toMatchObject({
      id: draft.id,
      incidentDescription: 'In-progress report stays on this device.',
    });
    expectNoRemoteDraftWork();
  });

  it('deletes only the local draft and ignores remote delete flags', async () => {
    const draft = buildDraft({ id: 'draft-delete-local-only' });
    await draftStorage.saveDraft(draft);

    await deleteDraft(draft.id, { syncRemote: true, enqueueSync: true });

    expect(await draftStorage.getDraft(draft.id)).toBeNull();
    expectNoRemoteDraftWork();
  });
});
