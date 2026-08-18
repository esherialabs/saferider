import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileSystemMock = vi.hoisted(() => ({
  getInfoAsync: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

const httpMock = vi.hoisted(() => ({
  request: vi.fn(),
  setAuthToken: vi.fn(),
}));

const consentMock = vi.hoisted(() => ({
  assertActivePathwayConsent: vi.fn(),
}));

vi.mock('expo-file-system/legacy', () => fileSystemMock);

vi.mock('../../lib/auth/authClient', () => ({
  authClient: authMock,
}));

vi.mock('../../lib/api/httpClient', () => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.status = status;
    }
  },
  request: httpMock.request,
  setAuthToken: httpMock.setAuthToken,
}));

vi.mock('../../utils/consentLedger', () => consentMock);

import { draftStorage, type DraftData } from '../../utils/draftStorage';
import {
  buildCaseSummary,
  CaseEvidenceUploadError,
  submitCase,
} from '../caseService';

function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    id: 'draft-referral-1',
    createdAt: new Date('2026-06-05T09:00:00.000Z'),
    updatedAt: new Date('2026-06-05T09:15:00.000Z'),
    incidentDescription: 'Unsafe conduct on a bus route.',
    selectedTags: ['harassment'],
    acceptedSuggestions: ['public_transport'],
    location: {
      address: 'Nairobi CBD',
      description: 'Near the stage',
    },
    datetime: {
      date: '2026-06-05',
      time: '09:00',
      accuracy: 'approximate',
    },
    mediaFiles: [
      {
        id: 'photo-1',
        type: 'photo',
        uri: 'file:///photo.jpg',
        fileName: 'photo.jpg',
        size: 1024,
        timestamp: new Date('2026-06-05T09:05:00.000Z'),
      },
    ],
    textEvidence: 'Vehicle notes',
    selectedProvider: '1195',
    selectedChannel: 'call',
    includeBrief: false,
    pathwayConsent: {
      recordId: 'consent-1',
      purpose: 'pathway_submission',
      version: 'pathway-consent.v1',
      pathway: 'referral',
      grantedAt: '2026-06-05T09:19:00.000Z',
    },
    referralSelection: {
      providerId: '1195',
      providerName: 'National GBV Toll-Free Helpline (HAK 1195)',
      providerType: 'Hotline',
      selectedChannel: 'call',
      includeBrief: false,
      phone: '1195',
      serviceScope: ['GBV support', 'Referral services'],
      availability: '24/7',
      catalogSource: 'seed',
      catalogLastUpdated: null,
      selectedAt: '2026-06-05T09:10:00.000Z',
    },
    ...overrides,
  };
}

function buildCaseRow(summary: Record<string, unknown> | null = null) {
  return {
    id: 'case-1',
    owner_id: 'owner-1',
    draft_id: 'draft-referral-1',
    pathway: 'referral',
    status: 'submitted' as const,
    summary,
    created_at: '2026-06-05T09:20:00.000Z',
    updated_at: '2026-06-05T09:20:00.000Z',
  };
}

beforeEach(async () => {
  vi.unstubAllGlobals();
  await draftStorage.clearAll();
  fileSystemMock.getInfoAsync.mockReset();
  authMock.getSession.mockResolvedValue({
    data: { session: { access_token: 'owned-token' } },
    error: null,
  });
  httpMock.request.mockReset();
  httpMock.request.mockResolvedValue({ case: buildCaseRow() });
  consentMock.assertActivePathwayConsent.mockReset();
  consentMock.assertActivePathwayConsent.mockResolvedValue({ id: 'consent-1', status: 'granted' });
});

describe('caseService minimized pathway contracts', () => {
  it('sends only provider id and channel when referral brief sharing is disabled', () => {
    const workflow = buildCaseSummary(buildDraft(), 'referral');
    expect(workflow).toEqual({
      schemaVersion: '1.0',
      workflowType: 'referral',
      providerId: '1195',
      channel: 'call',
      supportBrief: { included: false, selectedFields: [] },
    });
    const serialized = JSON.stringify(workflow);
    expect(serialized).not.toContain('Unsafe conduct');
    expect(serialized).not.toContain('Nairobi CBD');
    expect(serialized).not.toContain('photo.jpg');
    expect(serialized).not.toContain('National GBV');
  });

  it('limits an opted-in referral brief to explicitly selected minimized fields', () => {
    const draft = buildDraft({
      includeBrief: true,
      isOngoing: false,
      location: { ...buildDraft().location, type: 'public_transport' },
      referralSelection: { ...buildDraft().referralSelection!, includeBrief: true },
    });
    const workflow = buildCaseSummary(draft, 'referral');
    expect(workflow).toMatchObject({
      schemaVersion: '1.0',
      workflowType: 'referral',
      supportBrief: {
        included: true,
        selectedFields: ['incident_categories', 'time_context', 'location_type', 'ongoing_status'],
        incidentCategories: ['harassment', 'public_transport'],
        timeContext: { date: '2026-06-05', accuracy: 'approximate' },
        locationType: 'public_transport',
        isOngoing: false,
      },
    });
    const serialized = JSON.stringify(workflow);
    expect(serialized).not.toContain('Unsafe conduct');
    expect(serialized).not.toContain('Nairobi CBD');
    expect(serialized).not.toContain('Near the stage');
    expect(serialized).not.toContain('Vehicle notes');
    expect(serialized).not.toContain('phone');
  });

  it('never uploads evidence through the referral workflow, even when a brief is selected', async () => {
    const draft = buildDraft({
      includeBrief: true,
      referralSelection: { ...buildDraft().referralSelection!, includeBrief: true },
    });
    const result = await submitCase({ draft, pathway: 'referral' });
    expect(result.attachments).toEqual([]);
    expect(fileSystemMock.getInfoAsync).not.toHaveBeenCalled();
    expect(httpMock.request).toHaveBeenCalledTimes(1);
    expect(httpMock.request).toHaveBeenCalledWith(expect.objectContaining({
      path: '/cases',
      method: 'POST',
      body: expect.objectContaining({
        idempotencyKey: 'consent-1',
        pathwayConsent: {
          recordId: 'consent-1',
          purpose: 'pathway_submission',
          version: 'pathway-consent.v1',
        },
        workflow: expect.objectContaining({ workflowType: 'referral' }),
      }),
    }));
  });

  it('does not submit when the encrypted pathway consent was withdrawn', async () => {
    consentMock.assertActivePathwayConsent.mockRejectedValueOnce(new Error('withdrawn'));
    await expect(submitCase({ draft: buildDraft({ caseId: 'case-existing' }), pathway: 'referral' })).rejects.toThrow('withdrawn');
    expect(httpMock.request).not.toHaveBeenCalled();
  });

  it('keeps failed escalation evidence uploads queued and retryable', async () => {
    const draft = buildDraft({ pathwayConsent: { ...buildDraft().pathwayConsent!, pathway: 'escalate' } });
    await draftStorage.saveDraft(draft);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, blob: async () => new Blob(['']) })));
    await expect(submitCase({ draft, pathway: 'escalate' })).rejects.toBeInstanceOf(CaseEvidenceUploadError);
    expect(await draftStorage.getDraft(draft.id)).toMatchObject({
      status: 'queued',
      caseId: 'case-1',
      caseSubmissionError: expect.stringContaining('evidence item did not upload'),
      mediaFiles: [expect.objectContaining({ uploadStatus: 'failed' })],
    });
  });

  it('reuses a stored escalation case id and sends an explicit retention policy', async () => {
    const draft = buildDraft({
      caseId: 'case-existing',
      pathwayConsent: { ...buildDraft().pathwayConsent!, pathway: 'escalate' },
      mediaFiles: [{ ...buildDraft().mediaFiles![0], uploadStatus: 'failed', uploadError: 'network_error' }],
    });
    await draftStorage.saveDraft(draft);
    fileSystemMock.getInfoAsync.mockResolvedValue({ exists: true, size: 1024 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        blob: async () => new Blob(['evidence'], { type: 'image/jpeg' }),
      })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    httpMock.request.mockImplementation(async ({ path, method }: { path: string; method?: string }) => {
      if (path === '/cases/case-existing/evidence' && method === 'POST') {
        return {
          attachment: {
            id: 'attachment-1',
            owner_id: 'owner-1',
            case_id: 'case-existing',
            mime_type: 'image/jpeg',
            size_bytes: 1024,
            metadata: {},
            created_at: '2026-06-05T09:25:00.000Z',
          },
          upload: {
            method: 'POST',
            url: 'https://uploads.local/evidence',
            expiresInSeconds: 900,
            fields: { policy: 'signed-policy' },
          },
        };
      }

      if (path === '/cases/case-existing/evidence/attachment-1/complete' && method === 'POST') {
        return {
          attachment: {
            id: 'attachment-1',
            owner_id: 'owner-1',
            case_id: 'case-existing',
            mime_type: 'image/jpeg',
            size_bytes: 1024,
            metadata: {},
            status: 'uploaded',
            created_at: '2026-06-05T09:25:00.000Z',
          },
        };
      }

      throw new Error(`unexpected request ${method ?? 'GET'} ${path}`);
    });

    const result = await submitCase({ draft, pathway: 'escalate' });

    expect(result.caseRecord?.id).toBe('case-existing');
    expect(result.attachments).toHaveLength(1);
    expect(httpMock.request).not.toHaveBeenCalledWith(expect.objectContaining({ path: '/cases' }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('https://uploads.local/evidence');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'POST', body: expect.any(FormData) });
    const uploadRequest = httpMock.request.mock.calls.find(([call]) => call.path === '/cases/case-existing/evidence')?.[0];
    expect(uploadRequest?.body).toMatchObject({
      fileName: 'photo-1.jpg',
      mimeType: 'image/jpeg',
      retentionPolicyId: 'submitted-case-pending-legal-v1',
      metadata: expect.objectContaining({
        displayName: 'photo-1.jpg',
        mediaType: 'photo',
        privacyStatus: expect.any(Object),
      }),
    });
    expect(uploadRequest?.body).not.toHaveProperty('draftId');
    expect(uploadRequest?.body.metadata).not.toHaveProperty('originalFileName');
    expect(uploadRequest?.body.metadata).not.toHaveProperty('sourceDraftId');
    expect(JSON.stringify(uploadRequest?.body)).not.toContain('photo.jpg');
    expect(JSON.stringify(uploadRequest?.body)).not.toContain(draft.id);

    const saved = await draftStorage.getDraft(draft.id);
    expect(saved).toMatchObject({
      id: draft.id,
      status: 'submitted',
      caseId: 'case-existing',
    });
    expect(saved?.caseSubmissionError).toBeUndefined();
    expect(saved?.mediaFiles?.[0]).toMatchObject({
      uploadStatus: 'uploaded',
      attachmentId: 'attachment-1',
    });
    expect(saved?.mediaFiles?.[0].storagePath).toBeUndefined();
    expect(saved?.mediaFiles?.[0].uploadError).toBeUndefined();
  });

  it('keeps anonymous-map unavailable instead of creating an account-linked case', async () => {
    expect(() => buildCaseSummary(buildDraft(), 'anonymous-map')).toThrow(/does not create an account-linked case/);
    await expect(submitCase({ draft: buildDraft(), pathway: 'anonymous-map' })).rejects.toThrow(/unavailable/);
    expect(fileSystemMock.getInfoAsync).not.toHaveBeenCalled();
    expect(httpMock.request).not.toHaveBeenCalled();
  });

  it('submits escalation summaries as generated redacted packets instead of raw draft fields', async () => {
    const draft = buildDraft({
      mediaFiles: [],
      incidentDescription: 'Mary Jones reported the driver near Nairobi CBD.',
      textEvidence: 'Mary Jones shared +254712345678 and vehicle KDD 123A.',
      location: {
        address: 'Nairobi CBD',
        description: 'River Road stage',
      },
      escalationData: {
        redactionLevel: 'heavy',
        vehiclePlate: 'KDD 123A',
        saccoOperator: 'Super Metro',
        contactPreference: 'none',
      },
      pathwayConsent: { ...buildDraft().pathwayConsent!, pathway: 'escalate' },
    });

    await submitCase({ draft, pathway: 'escalate' });

    const workflow = httpMock.request.mock.calls[0][0].body.workflow as Record<string, any>;
    const serialized = JSON.stringify(workflow);

    expect(workflow).toMatchObject({
      schemaVersion: '1.0',
      workflowType: 'submitted-case',
      pathway: 'escalation',
      submission: {
        schemaVersion: '1.0',
        workflowType: 'escalation',
        packet: expect.objectContaining({ redactionLevel: 'heavy' }),
      },
    });
    expect(workflow).not.toHaveProperty('incidentDescription');
    expect(workflow.submission.packet).not.toHaveProperty('sourceDraftId');
    expect(serialized).not.toContain('Mary Jones');
    expect(serialized).not.toContain('+254712345678');
    expect(serialized).not.toContain('KDD 123A');
    expect(serialized).not.toContain('Nairobi CBD');
    expect(serialized).not.toContain(draft.id);
  });

  it('blocks evidence upload when a requested privacy transform is incomplete', async () => {
    const draft = buildDraft({
      privacySettings: { blurFaces: true, removeMetadata: false, encryptFiles: false },
      pathwayConsent: { ...buildDraft().pathwayConsent!, pathway: 'escalate' },
    });
    await draftStorage.saveDraft(draft);
    await expect(submitCase({ draft, pathway: 'escalate' })).rejects.toBeInstanceOf(CaseEvidenceUploadError);
    expect(fileSystemMock.getInfoAsync).not.toHaveBeenCalled();
    expect(httpMock.request).toHaveBeenCalledTimes(1);
  });

  it('blocks evidence upload when a requested transform is unavailable for the item', async () => {
    const draft = buildDraft({
      privacySettings: { blurFaces: true, removeMetadata: false, encryptFiles: false },
      pathwayConsent: { ...buildDraft().pathwayConsent!, pathway: 'escalate' },
      mediaFiles: [{
        ...buildDraft().mediaFiles![0],
        id: 'audio-1',
        type: 'audio',
        uri: 'file:///audio.m4a',
        fileName: 'audio.m4a',
      }],
    });
    await draftStorage.saveDraft(draft);
    await expect(submitCase({ draft, pathway: 'escalate' })).rejects.toBeInstanceOf(CaseEvidenceUploadError);
    expect(fileSystemMock.getInfoAsync).not.toHaveBeenCalled();
    expect(httpMock.request).toHaveBeenCalledTimes(1);
  });

});
