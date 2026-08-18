import { describe, expect, it } from 'vitest';

import type { DraftData } from '../../../utils/draftStorage';
import { getReportWizardSaveStatus } from '../reportWizardSaveStatus';

const savedAt = new Date('2026-07-05T07:12:00.000Z');

function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    id: 'draft-progress-1',
    createdAt: new Date('2026-07-05T07:00:00.000Z'),
    updatedAt: savedAt,
    currentStep: 'WhereWhen',
    completedSteps: ['WhatHappened'],
    ...overrides,
  };
}

describe('report wizard save status', () => {
  it('shows ordinary editable drafts as local device saves regardless of global sync state', () => {
    const status = getReportWizardSaveStatus({
      draft: buildDraft(),
    });

    expect(status).toMatchObject({
      label: 'Saved on this device',
      variant: 'success',
    });
    expect(status.detail).toContain('Last saved');
    expect(status.detail).not.toContain('sync');
    expect(status.detail).not.toContain('queued');
  });

  it('names local writes while the draft is saving', () => {
    expect(getReportWizardSaveStatus({
      draft: buildDraft(),
      isSaving: true,
    })).toEqual({
      label: 'Saving locally',
      detail: 'Saving this draft on the device.',
      variant: 'warning',
    });
  });

  it('keeps queued legacy sync copy out of the report progress header', () => {
    expect(getReportWizardSaveStatus({
      draft: buildDraft({ status: 'queued', currentStep: 'queued' }),
    })).toEqual({
      label: 'Saved on this device',
      detail: expect.stringContaining('Last saved'),
      variant: 'success',
    });
  });

  it('surfaces actual local save errors', () => {
    expect(getReportWizardSaveStatus({
      draft: buildDraft(),
      error: 'Failed to save draft',
    })).toEqual({
      label: 'Save failed',
      detail: 'Failed to save draft',
      variant: 'destructive',
    });
  });
});
