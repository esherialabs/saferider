import { describe, expect, it } from 'vitest';

import type { CaseAttachment } from '../../services/caseService';
import type { DraftData } from '../draftStorage';
import { buildCaseDetailSource, normalizeCaseSummaryPayload } from '../caseDetailDisplay';

function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    id: 'draft-1',
    createdAt: new Date('2026-06-05T08:00:00.000Z'),
    updatedAt: new Date('2026-06-05T08:15:00.000Z'),
    status: 'submitted',
    incidentDescription: 'Local narrative that was not sent.',
    textEvidence: 'Local notes that must stay local.',
    selectedTags: ['local-tag'],
    acceptedSuggestions: ['local-suggestion'],
    patterns: ['local-pattern'],
    selectedPathway: 'anonymous-map',
    location: { description: 'Local location fallback' },
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

const remoteAttachment: CaseAttachment = {
  id: 'attachment-1',
  mimeType: 'image/jpeg',
  sizeBytes: 1024,
  createdAt: new Date('2026-06-05T09:00:00.000Z'),
};

describe('case detail display source', () => {
  it('prevents anonymous-map records from falling back to local narrative or evidence', () => {
    const source = buildCaseDetailSource({
      casePathway: 'anonymous-map',
      localDraft: buildDraft(),
      attachments: [remoteAttachment],
      summary: {
        pathway: 'anonymous-map',
        mediaCount: 9,
        anonymousMapSignal: {
          location: { description: 'Remote signal location' },
          locationPrecision: 'saved_description_or_address',
          datetime: { date: '2026-06-05', time: '08:05', accuracy: 'approximate' },
          duration: 'under_5_min',
          isOngoing: true,
          categories: ['harassment', 'public_transport', 'harassment'],
        },
      },
    });

    expect(source.isAnonymousMapRecord).toBe(true);
    expect(source.localDraftFallbackAllowed).toBe(false);
    expect(source.mediaCount).toBe(0);
    expect(source.localMediaFiles).toEqual([]);
    expect(source.showAttachmentSyncNotice).toBe(false);
    expect(source.summaryLocation).toEqual({ description: 'Remote signal location' });
    expect(source.summaryDatetime).toEqual({ date: '2026-06-05', time: '08:05', accuracy: 'approximate' });
    expect(source.anonymousMapCategories).toEqual(['harassment', 'public_transport']);
  });

  it('keeps local fallbacks for ordinary remote records when summary fields are absent', () => {
    const draft = buildDraft({ selectedPathway: 'referral' });
    const source = buildCaseDetailSource({
      casePathway: 'referral',
      localDraft: draft,
      attachments: [],
      summary: { pathway: 'referral' },
    });

    expect(source.isAnonymousMapRecord).toBe(false);
    expect(source.localDraftFallbackAllowed).toBe(true);
    expect(source.mediaCount).toBe(1);
    expect(source.localMediaFiles).toEqual(draft.mediaFiles);
    expect(source.showAttachmentSyncNotice).toBe(true);
    expect(source.summaryLocation).toBeNull();
  });

  it('normalizes the minimized referral envelope without inventing narrative or exact location', () => {
    const summary = normalizeCaseSummaryPayload({
      schemaVersion: '1.0',
      pathwayConsent: { purpose: 'pathway_submission', version: 'pathway-consent.v1' },
      workflow: {
        schemaVersion: '1.0', workflowType: 'referral', providerId: 'provider-1', channel: 'call',
        supportBrief: {
          included: true, selectedFields: ['incident_categories', 'time_context', 'location_type'],
          incidentCategories: ['harassment'], timeContext: { date: '2026-07-30', accuracy: 'approximate' },
          locationType: 'public_transport',
        },
      },
    });
    expect(summary).toMatchObject({
      pathway: 'referral', selectedProvider: 'provider-1', selectedChannel: 'call',
      supportBriefIncluded: true, tags: ['harassment'], location: { type: 'public_transport' }, mediaCount: 0,
    });
    expect(summary).not.toHaveProperty('incidentDescription');
    expect(summary.location).not.toHaveProperty('coordinates');
  });
});
