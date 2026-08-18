import type { DraftData } from './draftStorage';

const NON_EDITABLE_DRAFT_STATUSES = new Set<NonNullable<DraftData['status']>>([
  'archived',
  'closed',
  'queued',
  'submitted',
]);

const FINAL_CURRENT_STEPS = new Set(['completed', 'queued', 'submitted']);

function getDraftUpdatedTime(draft: DraftData): number {
  const time = draft.updatedAt?.getTime();
  return typeof time === 'number' && !Number.isNaN(time) ? time : 0;
}

export function isEditableReportDraft(draft: DraftData): boolean {
  if (draft.status && NON_EDITABLE_DRAFT_STATUSES.has(draft.status)) {
    return false;
  }

  if (draft.currentStep && FINAL_CURRENT_STEPS.has(draft.currentStep)) {
    return false;
  }

  return true;
}

export function compareDraftsByUpdatedAtDesc(a: DraftData, b: DraftData): number {
  return getDraftUpdatedTime(b) - getDraftUpdatedTime(a);
}

export function getEditableReportDrafts(drafts: DraftData[]): DraftData[] {
  return drafts.filter(isEditableReportDraft).sort(compareDraftsByUpdatedAtDesc);
}

export function getLatestEditableReportDraft(drafts: DraftData[]): DraftData | null {
  return getEditableReportDrafts(drafts)[0] ?? null;
}
