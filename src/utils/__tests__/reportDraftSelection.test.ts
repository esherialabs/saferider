import { describe, expect, it } from 'vitest';

import type { DraftData } from '../draftStorage';
import {
  getEditableReportDrafts,
  getLatestEditableReportDraft,
  isEditableReportDraft,
} from '../reportDraftSelection';

function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    id: 'draft-1',
    createdAt: new Date('2026-07-03T08:00:00.000Z'),
    updatedAt: new Date('2026-07-03T08:00:00.000Z'),
    status: 'draft',
    completedSteps: [],
    ...overrides,
  };
}

describe('report draft selection', () => {
  it('keeps only drafts that can be edited from the report workspace', () => {
    expect(isEditableReportDraft(buildDraft({ status: 'draft' }))).toBe(true);
    expect(isEditableReportDraft(buildDraft({ status: undefined, currentStep: 'WhereWhen' }))).toBe(true);
    expect(isEditableReportDraft(buildDraft({ status: 'queued' }))).toBe(false);
    expect(isEditableReportDraft(buildDraft({ status: 'submitted' }))).toBe(false);
    expect(isEditableReportDraft(buildDraft({ status: 'archived' }))).toBe(false);
    expect(isEditableReportDraft(buildDraft({ status: 'closed' }))).toBe(false);
    expect(isEditableReportDraft(buildDraft({ currentStep: 'completed' }))).toBe(false);
    expect(isEditableReportDraft(buildDraft({ currentStep: 'queued' }))).toBe(false);
  });

  it('returns editable drafts newest first', () => {
    const oldest = buildDraft({
      id: 'oldest',
      updatedAt: new Date('2026-07-02T08:00:00.000Z'),
    });
    const latest = buildDraft({
      id: 'latest',
      updatedAt: new Date('2026-07-03T18:30:00.000Z'),
    });
    const submitted = buildDraft({
      id: 'submitted',
      status: 'submitted',
      updatedAt: new Date('2026-07-04T09:00:00.000Z'),
    });

    expect(getEditableReportDrafts([oldest, submitted, latest]).map((draft) => draft.id)).toEqual([
      'latest',
      'oldest',
    ]);
    expect(getLatestEditableReportDraft([oldest, submitted, latest])?.id).toBe('latest');
  });

  it('returns null when there is no editable draft', () => {
    expect(getLatestEditableReportDraft([
      buildDraft({ id: 'queued', status: 'queued' }),
      buildDraft({ id: 'done', currentStep: 'completed' }),
    ])).toBeNull();
  });
});
