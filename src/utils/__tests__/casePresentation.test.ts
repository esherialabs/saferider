import { describe, expect, it } from 'vitest';

import type { CaseRecord } from '../../services/caseService';
import type { DraftData } from '../draftStorage';
import type { SyncQueueItem } from '../offlineSync';
import {
  buildCaseCollection,
  buildDraftTimelineItems,
  canDeleteLocalDraft,
  deriveDraftDisplayState,
  deriveRemoteDisplayState,
  getQueueItemsForDraft,
} from '../casePresentation';

function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    id: 'draft-1',
    createdAt: new Date('2026-06-05T08:00:00.000Z'),
    updatedAt: new Date('2026-06-05T08:15:00.000Z'),
    status: 'draft',
    incidentDescription: 'Driver refused to stop near the stage.',
    selectedTags: ['harassment'],
    acceptedSuggestions: ['public_transport'],
    selectedPathway: 'referral',
    location: {
      description: 'River Road stage',
      address: 'Nairobi CBD',
    },
    mediaFiles: [
      {
        id: 'media-1',
        type: 'photo',
        uri: 'file:///photo.jpg',
        fileName: 'photo.jpg',
        size: 1024,
        timestamp: new Date('2026-06-05T08:10:00.000Z'),
      },
    ],
    ...overrides,
  };
}

function buildRemoteCase(overrides: Partial<CaseRecord> = {}): CaseRecord {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    draftId: 'draft-remote',
    pathway: 'referral',
    status: 'submitted',
    summary: {
      incidentDescription: 'Remote case summary',
      location: { description: 'Saved provider location' },
      tags: ['provider'],
      mediaCount: 1,
    },
    createdAt: new Date('2026-06-05T09:00:00.000Z'),
    updatedAt: new Date('2026-06-05T09:10:00.000Z'),
    ...overrides,
  };
}

function buildSubmitQueueItem(overrides: Partial<SyncQueueItem> = {}): SyncQueueItem {
  return {
    id: 'submit-1',
    type: 'submit',
    data: {
      draftId: 'draft-queued',
      pathway: 'referral',
    },
    timestamp: new Date('2026-06-05T09:30:00.000Z'),
    retryCount: 0,
    maxRetries: 3,
    ...overrides,
  };
}

describe('case presentation model', () => {
  it('keeps local drafts visible when remote cases are unavailable', () => {
    const collection = buildCaseCollection([buildDraft()], []);

    expect(collection.drafts).toHaveLength(1);
    expect(collection.active).toHaveLength(0);
    expect(collection.drafts[0]).toMatchObject({
      draftId: 'draft-1',
      source: 'local_draft',
      presentation: {
        state: 'draft',
        section: 'drafts',
      },
    });
  });

  it('keeps step 4 review drafts editable and exposes report progress', () => {
    const collection = buildCaseCollection([
      buildDraft({
        selectedPathway: undefined,
        completedSteps: ['WhatHappened', 'WhereWhen', 'EvidenceDetail'],
        currentStep: 'ConsentGate',
        status: 'draft',
      }),
    ], []);

    expect(collection.drafts).toHaveLength(1);
    expect(collection.active).toHaveLength(0);
    expect(collection.drafts[0]).toMatchObject({
      draftId: 'draft-1',
      source: 'local_draft',
      presentation: { state: 'draft' },
      reportProgress: {
        completedSteps: 3,
        totalSteps: 4,
        percentage: 75,
        currentStepLabel: 'Review and next step',
        isComplete: false,
      },
    });
    expect(collection.drafts[0].reportProgress?.steps.at(-1)).toMatchObject({
      id: 'review-next-step',
      status: 'current',
    });
  });

  it('moves completed local pathways out of editable drafts without requiring a queue item', () => {
    const privateDraft = buildDraft({
      id: 'draft-private-local',
      selectedPathway: 'save-private',
      currentStep: 'completed',
      completedSteps: ['WhatHappened', 'WhereWhen', 'EvidenceDetail', 'ConsentGate'],
      status: 'draft',
    });
    const referralDraft = buildDraft({
      id: 'draft-referral-local',
      selectedPathway: 'referral',
      currentStep: 'completed',
      completedSteps: ['WhatHappened', 'WhereWhen', 'EvidenceDetail', 'ReferralPicker', 'ConsentGate'],
      status: 'draft',
    });

    expect(deriveDraftDisplayState(privateDraft)).toBe('local_complete');
    expect(deriveDraftDisplayState(referralDraft)).toBe('provider_pending');
    expect(canDeleteLocalDraft(privateDraft)).toBe(false);
    expect(canDeleteLocalDraft(referralDraft)).toBe(false);

    const collection = buildCaseCollection([privateDraft, referralDraft], []);
    expect(collection.drafts).toHaveLength(0);
    expect(collection.active.map(item => item.presentation.state)).toEqual([
      'provider_pending',
      'local_complete',
    ]);
  });

  it('separates draft, queued, submitted, provider-pending, escalated, and closed cases', () => {
    const queuedDraft = buildDraft({
      id: 'draft-queued',
      status: 'queued',
      selectedPathway: 'referral',
    });
    const privateSubmitted = buildDraft({
      id: 'draft-private',
      status: 'submitted',
      selectedPathway: 'save-private',
    });
    const remoteReferral = buildRemoteCase({
      id: '22222222-2222-4222-8222-222222222222',
      status: 'referred',
      pathway: 'referral',
    });
    const remoteEscalation = buildRemoteCase({
      id: '33333333-3333-4333-8333-333333333333',
      draftId: 'draft-escalate',
      pathway: 'escalate',
      status: 'in_review',
    });
    const remoteClosed = buildRemoteCase({
      id: '44444444-4444-4444-8444-444444444444',
      draftId: 'draft-closed',
      status: 'closed',
      pathway: 'referral',
    });

    const collection = buildCaseCollection(
      [buildDraft(), queuedDraft, privateSubmitted],
      [remoteReferral, remoteEscalation, remoteClosed],
      [buildSubmitQueueItem()],
    );

    expect(collection.drafts.map(item => item.presentation.state)).toEqual(['draft']);
    expect(collection.active.map(item => item.presentation.state)).toEqual([
      'queued',
      'escalated',
      'provider_pending',
      'submitted',
    ]);
    expect(collection.closed.map(item => item.presentation.state)).toEqual(['closed']);
  });

  it('treats retrying optional online sync as failed sync without deleting the local case', () => {
    const queueItem = buildSubmitQueueItem({
      retryCount: 1,
    });
    const draft = buildDraft({
      id: 'draft-queued',
      status: 'queued',
    });

    expect(deriveDraftDisplayState(draft, [queueItem])).toBe('failed_sync');

    const timeline = buildDraftTimelineItems(draft, [queueItem]);
    expect(timeline[0]).toMatchObject({
      title: 'Sync needs attention',
      chips: ['Retry sync'],
    });
  });

  it('surfaces retained auth-blocked queue items as failed sync with recovery copy', () => {
    const queueItem = buildSubmitQueueItem({
      blockedReason: 'auth_required',
      lastError: 'User is not authenticated',
    });
    const draft = buildDraft({
      id: 'draft-queued',
      status: 'queued',
    });

    expect(deriveDraftDisplayState(draft, [queueItem])).toBe('failed_sync');

    const timeline = buildDraftTimelineItems(draft, [queueItem]);
    expect(timeline[0]).toMatchObject({
      title: 'Sync needs attention',
      body: expect.stringContaining('Optional online sync needs attention'),
    });
  });

  it('prevents queued local submissions from being treated as deletable drafts', () => {
    const draft = buildDraft({
      id: 'draft-queued',
      status: 'draft',
    });
    const queueItem = buildSubmitQueueItem();

    expect(deriveDraftDisplayState(draft, [queueItem])).toBe('queued');
    expect(canDeleteLocalDraft(draft, [queueItem])).toBe(false);
    expect(getQueueItemsForDraft([queueItem], draft.id)).toEqual([queueItem]);

    const collection = buildCaseCollection([draft], [], [queueItem]);
    expect(collection.drafts).toHaveLength(0);
    expect(collection.active[0]).toMatchObject({
      draftId: draft.id,
      source: 'local_submission',
      presentation: { state: 'queued' },
      queueItems: [queueItem],
    });
  });

  it('ignores obsolete draft sync queue items when deriving local draft state', () => {
    const draft = buildDraft({
      id: 'draft-local-only',
      status: 'draft',
    });
    const obsoleteDraftSyncItem: SyncQueueItem = {
      id: 'draft-update-obsolete',
      type: 'update',
      data: {
        resource: 'draft',
        payload: {
          id: draft.id,
          payload: { currentStep: 'ConsentGate' },
        },
      },
      timestamp: new Date('2026-06-05T09:40:00.000Z'),
      retryCount: 2,
      maxRetries: 3,
      lastError: 'No authenticated API session',
    };

    expect(getQueueItemsForDraft([obsoleteDraftSyncItem], draft.id)).toEqual([]);
    expect(deriveDraftDisplayState(draft, [obsoleteDraftSyncItem])).toBe('draft');
    expect(canDeleteLocalDraft(draft, [obsoleteDraftSyncItem])).toBe(true);
  });

  it('allows deletion only for editable local drafts without queue work', () => {
    const editableDraft = buildDraft({
      id: 'draft-editable',
      status: 'draft',
    });
    const queuedDraft = buildDraft({
      id: 'draft-queued',
      status: 'queued',
    });
    const submittedDraft = buildDraft({
      id: 'draft-submitted',
      status: 'submitted',
    });

    expect(canDeleteLocalDraft(editableDraft)).toBe(true);
    expect(canDeleteLocalDraft(queuedDraft)).toBe(false);
    expect(canDeleteLocalDraft(submittedDraft)).toBe(false);
    expect(
      canDeleteLocalDraft(editableDraft, [
        buildSubmitQueueItem({
          data: {
            draftId: 'draft-editable',
            pathway: 'referral',
          },
          retryCount: 1,
        }),
      ]),
    ).toBe(false);
  });

  it('deduplicates local submitted drafts when the remote case references the same draft id', () => {
    const localSubmitted = buildDraft({
      id: 'draft-remote',
      status: 'submitted',
    });
    const remote = buildRemoteCase({
      draftId: 'draft-remote',
      status: 'submitted',
    });

    const collection = buildCaseCollection([localSubmitted], [remote]);

    expect(collection.active).toHaveLength(1);
    expect(collection.active[0]).toMatchObject({
      source: 'remote_case',
      caseId: remote.id,
      presentation: {
        state: 'provider_pending',
      },
    });
  });

  it('derives needs-attention from remote summary or events', () => {
    expect(deriveRemoteDisplayState(buildRemoteCase({
      summary: { actionRequired: true },
    }))).toBe('needs_attention');

    expect(deriveRemoteDisplayState(buildRemoteCase(), [
      {
        id: 'event-1',
        caseId: 'case-1',
        ownerId: 'owner-1',
        eventType: 'action_required',
        payload: {},
        createdAt: new Date('2026-06-05T10:00:00.000Z'),
      },
    ])).toBe('needs_attention');
  });
});
