import type { DraftData } from '../../utils/draftStorage';

export type ReportWizardSaveVariant = 'success' | 'warning' | 'destructive' | 'secondary';

type ReportWizardSaveStatusOptions = {
  draft: DraftData | null | undefined;
  isSaving?: boolean;
  lastSaved?: Date | null;
  error?: string | null;
};

export type ReportWizardSaveStatus = {
  label: string;
  detail: string;
  variant: ReportWizardSaveVariant;
};

function formatSavedAt(value?: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) {
    return 'Draft saves on this device.';
  }

  return 'Last saved ' + value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getReportWizardSaveStatus({
  draft,
  isSaving = false,
  lastSaved,
  error,
}: ReportWizardSaveStatusOptions): ReportWizardSaveStatus {
  if (error) {
    return {
      label: 'Save failed',
      detail: error,
      variant: 'destructive',
    };
  }

  if (!draft) {
    return {
      label: 'Loading draft',
      detail: 'Progress appears after the draft loads.',
      variant: 'secondary',
    };
  }

  if (isSaving) {
    return {
      label: 'Saving locally',
      detail: 'Saving this draft on the device.',
      variant: 'warning',
    };
  }

  return {
    label: 'Saved on this device',
    detail: formatSavedAt(lastSaved ?? draft.updatedAt),
    variant: 'success',
  };
}
