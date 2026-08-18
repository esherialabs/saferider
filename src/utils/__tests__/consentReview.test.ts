import { describe, expect, it } from 'vitest';

import { getConsentValidation } from '../consentReview';

describe('consent review validation', () => {
  it('blocks referral submissions until a provider and channel are selected', () => {
    expect(getConsentValidation('referral', {})).toEqual({
      valid: false,
      code: 'referral-provider-required',
      message: 'Choose a support provider before sending a referral.',
      actionLabel: 'Choose provider',
      actionRoute: 'ReferralPicker',
    });
    expect(getConsentValidation('referral', { provider: 'Usikimye' })).toEqual({
      valid: false,
      code: 'referral-channel-required',
      message: 'Choose how SafeRide should contact the selected provider.',
      actionLabel: 'Choose channel',
      actionRoute: 'ReferralPicker',
    });
  });

  it('allows referral submissions with a provider and channel', () => {
    expect(getConsentValidation('referral', { provider: 'Usikimye', selectedChannel: 'call' })).toEqual({ valid: true });
  });

  it('allows a source-linked pending provider to be saved without enabling a contact action', () => {
    expect(getConsentValidation('referral', {
      draft: {
        referralSelection: {
          providerId: 'legal-1',
          providerName: 'FIDA Kenya',
          providerType: 'Legal aid',
          contactStatus: 'pending',
          includeBrief: false,
          serviceScope: ['Legal aid'],
          selectedAt: '2026-08-15T00:00:00.000Z',
        },
      },
    })).toEqual({ valid: true });
  });

  it('requires location and category for map update records when a draft is available', () => {
    expect(getConsentValidation('anonymous-map', { draft: {} })).toMatchObject({
      valid: false,
      code: 'anonymous-map-location-required',
      actionRoute: 'WhereWhen',
    });

    expect(getConsentValidation('anonymous-map', {
      draft: { location: { description: 'Bus stop' } },
    })).toMatchObject({
      valid: false,
      code: 'anonymous-map-category-required',
      actionRoute: 'WhatHappened',
    });

    expect(getConsentValidation('anonymous-map', {
      draft: { location: { description: 'Bus stop' }, selectedTags: ['harassment'] },
    })).toEqual({ valid: true });
  });

  it('requires escalation details and a requested alias before escalation consent', () => {
    expect(getConsentValidation('escalate', { draft: {} })).toMatchObject({
      valid: false,
      code: 'escalation-details-required',
      actionRoute: 'EscalationForm',
    });

    expect(getConsentValidation('escalate', {
      draft: { escalationData: { contactPreference: 'alias', alias: '   ' } },
    })).toMatchObject({
      valid: false,
      code: 'escalation-alias-required',
      actionRoute: 'EscalationForm',
    });

    expect(getConsentValidation('escalate', {
      draft: { escalationData: { contactPreference: 'none' } },
    })).toEqual({ valid: true });
  });

  it('allows save-private without network submission fields', () => {
    expect(getConsentValidation('save-private', { draft: {} })).toEqual({ valid: true });
  });

  it('blocks any pathway when the draft failed to load', () => {
    expect(getConsentValidation('save-private', { draft: null })).toEqual({
      valid: false,
      code: 'draft-required',
      message: 'SafeRide needs the local report details before review. Reopen the report editor and save the step again.',
      actionLabel: 'Open editor',
      actionRoute: 'WhatHappened',
    });
  });
});
