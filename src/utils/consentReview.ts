import { PathwayType } from '../types/pathways';
import type { ConsentEditRoute } from './consentSummary';
import type { DraftData } from './draftStorage';

export type ConsentValidationResult =
  | { valid: true }
  | {
      valid: false;
      code:
        | 'draft-required'
        | 'anonymous-map-location-required'
        | 'anonymous-map-category-required'
        | 'anonymous-map-online-required'
        | 'referral-provider-required'
        | 'referral-channel-required'
        | 'escalation-details-required'
        | 'escalation-alias-required';
      message: string;
      actionLabel: string;
      actionRoute: ConsentEditRoute;
    };

type ConsentValidationDraft = Partial<Pick<
  DraftData,
  | 'location'
  | 'patterns'
  | 'acceptedSuggestions'
  | 'selectedTags'
  | 'customTags'
  | 'selectedProvider'
  | 'selectedChannel'
  | 'referralSelection'
  | 'escalationData'
>>;

function hasSavedLocation(draft: ConsentValidationDraft): boolean {
  return Boolean(
    draft.location?.coordinates ||
    draft.location?.description?.trim() ||
    draft.location?.address?.trim() ||
    draft.location?.type?.trim(),
  );
}

function hasCategory(draft: ConsentValidationDraft): boolean {
  return Boolean(
    draft.patterns?.length ||
    draft.acceptedSuggestions?.length ||
    draft.selectedTags?.length ||
    draft.customTags?.length,
  );
}

export function getConsentValidation(
  pathway: PathwayType,
  data: {
    draft?: ConsentValidationDraft | null;
    provider?: string | null;
    selectedChannel?: string | null;
  },
): ConsentValidationResult {
  if (data.draft === null) {
    return {
      valid: false,
      code: 'draft-required',
      message: 'SafeRide needs the local report details before review. Reopen the report editor and save the step again.',
      actionLabel: 'Open editor',
      actionRoute: 'WhatHappened',
    };
  }

  const draft = data.draft;

  if (pathway === 'anonymous-map' && draft) {
    if (!hasSavedLocation(draft)) {
      return {
        valid: false,
        code: 'anonymous-map-location-required',
        message: 'Add a location before sending a map update record.',
        actionLabel: 'Edit location',
        actionRoute: 'WhereWhen',
      };
    }

    if (!hasCategory(draft)) {
      return {
        valid: false,
        code: 'anonymous-map-category-required',
        message: 'Choose at least one incident type or tag before sending a map update record.',
        actionLabel: 'Edit incident type',
        actionRoute: 'WhatHappened',
      };
    }
  }

  if (pathway === 'referral') {
    const provider =
      data.provider ??
      draft?.referralSelection?.providerName ??
      draft?.selectedProvider ??
      null;
    if (!provider?.trim()) {
      return {
        valid: false,
        code: 'referral-provider-required',
        message: 'Choose a support provider before sending a referral.',
        actionLabel: 'Choose provider',
        actionRoute: 'ReferralPicker',
      };
    }

    const selectedChannel =
      data.selectedChannel ??
      draft?.referralSelection?.selectedChannel ??
      draft?.selectedChannel ??
      null;
    const providerOnlySelectionAllowed = Boolean(
      draft?.referralSelection?.contactStatus === 'pending',
    );
    if (!selectedChannel?.trim() && !providerOnlySelectionAllowed) {
      return {
        valid: false,
        code: 'referral-channel-required',
        message: 'Choose how SafeRide should contact the selected provider.',
        actionLabel: 'Choose channel',
        actionRoute: 'ReferralPicker',
      };
    }
  }

  if (pathway === 'escalate' && draft) {
    if (!draft.escalationData) {
      return {
        valid: false,
        code: 'escalation-details-required',
        message: 'Review escalation details before sending a packet.',
        actionLabel: 'Edit escalation',
        actionRoute: 'EscalationForm',
      };
    }

    if (draft.escalationData.contactPreference === 'alias' && !draft.escalationData.alias?.trim()) {
      return {
        valid: false,
        code: 'escalation-alias-required',
        message: 'Add an alias or choose no follow-up before sending this escalation packet.',
        actionLabel: 'Edit contact',
        actionRoute: 'EscalationForm',
      };
    }
  }

  return { valid: true };
}
