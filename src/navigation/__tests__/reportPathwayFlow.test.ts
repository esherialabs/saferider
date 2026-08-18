import { describe, expect, it } from 'vitest';

import type { DraftData } from '../../utils/draftStorage';
import {
  canUseReportPathway,
  getActiveReportWizardSteps,
  getCompletedStepsBeforeConsent,
  getNextIncompleteReportStep,
  getOptionalReportStepSkipTarget,
  getReportPathwayDestination,
  getReportWizardProgress,
  getReportWizardResumeTarget,
  getSubmittedReportSteps,
  REPORT_PATHWAY_FLOW,
  REPORT_STEPS_BEFORE_CONSENT,
} from '../reportPathwayFlow';

const now = new Date('2026-06-06T09:00:00Z');

function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    id: 'draft-1',
    createdAt: now,
    updatedAt: now,
    completedSteps: [],
    ...overrides,
  };
}

describe('report pathway flow', () => {
  it('allows every pathway to be prepared and completed locally first', () => {
    expect(REPORT_PATHWAY_FLOW['save-private']).toMatchObject({ requiresNetwork: false, queuesOffline: false });
    expect(REPORT_PATHWAY_FLOW['anonymous-map']).toMatchObject({ requiresNetwork: false, queuesOffline: false });
    expect(REPORT_PATHWAY_FLOW.referral).toMatchObject({ requiresNetwork: false, queuesOffline: false });
    expect(REPORT_PATHWAY_FLOW.escalate).toMatchObject({ requiresNetwork: false, queuesOffline: false });

    expect(canUseReportPathway('save-private', false)).toBe(true);
    expect(canUseReportPathway('anonymous-map', false)).toBe(true);
    expect(canUseReportPathway('referral', false)).toBe(true);
    expect(canUseReportPathway('escalate', false)).toBe(true);
    expect(canUseReportPathway('escalate', true)).toBe(true);
  });

  it('routes save-private to consent before local completion', () => {
    expect(getReportPathwayDestination('save-private', 'draft-1')).toEqual({
      route: 'ConsentGate',
      params: { draftId: 'draft-1' },
    });
  });

  it('routes anonymous map directly to consent', () => {
    expect(getReportPathwayDestination('anonymous-map', 'draft-1')).toEqual({
      route: 'ConsentGate',
      params: { draftId: 'draft-1' },
    });
  });

  it('routes referral through provider selection before consent', () => {
    expect(getReportPathwayDestination('referral', 'draft-1')).toEqual({
      route: 'ReferralPicker',
      params: { draftId: 'draft-1' },
    });
  });

  it('routes escalation through packet details before consent', () => {
    expect(getReportPathwayDestination('escalate', 'draft-1')).toEqual({
      route: 'EscalationForm',
      params: { draftId: 'draft-1' },
    });
  });

  it('tracks pre-consent and submitted steps by pathway', () => {
    expect(REPORT_STEPS_BEFORE_CONSENT).toEqual([
      'WhatHappened',
      'WhereWhen',
      'EvidenceDetail',
    ]);
    expect(getCompletedStepsBeforeConsent('save-private')).toEqual(REPORT_STEPS_BEFORE_CONSENT);
    expect(getCompletedStepsBeforeConsent('anonymous-map')).toEqual(REPORT_STEPS_BEFORE_CONSENT);
    expect(getCompletedStepsBeforeConsent('referral')).toEqual([...REPORT_STEPS_BEFORE_CONSENT, 'ReferralPicker']);
    expect(getCompletedStepsBeforeConsent('escalate')).toEqual([...REPORT_STEPS_BEFORE_CONSENT, 'EscalationForm']);
    expect(getSubmittedReportSteps('referral')).toEqual([...REPORT_STEPS_BEFORE_CONSENT, 'ReferralPicker', 'ConsentGate']);
  });

  it('keeps pathway detail screens out of the step model', () => {
    expect(getActiveReportWizardSteps(buildDraft()).map(step => step.id)).toEqual([
      'what-happened',
      'where-when',
      'evidence',
      'review-next-step',
      'completion',
    ]);

    expect(getActiveReportWizardSteps(buildDraft({ selectedPathway: 'referral' })).map(step => step.id)).toEqual([
      'what-happened',
      'where-when',
      'evidence',
      'review-next-step',
      'completion',
    ]);
    expect(getActiveReportWizardSteps(buildDraft({ selectedPathway: 'escalate' })).map(step => step.id)).not.toContain('escalation-details');

    expect(getReportWizardProgress(buildDraft()).steps.map(step => step.id)).toEqual([
      'what-happened',
      'where-when',
      'evidence',
      'review-next-step',
    ]);
  });

  it('routes resume to the next incomplete wizard step using draft data', () => {
    expect(getNextIncompleteReportStep(buildDraft())).toEqual({
      route: 'WhatHappened',
      params: { draftId: 'draft-1' },
    });

    expect(getNextIncompleteReportStep(buildDraft({
      completedSteps: ['WhatHappened', 'WhereWhen'],
    }))).toEqual({ route: 'EvidenceDetail', params: { draftId: 'draft-1' } });

    expect(getNextIncompleteReportStep(buildDraft({
      completedSteps: ['WhatHappened', 'WhereWhen', 'EvidenceDetail'],
    }))).toEqual({ route: 'ConsentGate', params: { draftId: 'draft-1' } });

    const reviewDraft = buildDraft({
      completedSteps: REPORT_STEPS_BEFORE_CONSENT,
      currentStep: 'ConsentGate',
      selectedPathway: 'save-private',
      status: 'draft',
    });
    expect(getReportWizardResumeTarget(reviewDraft)).toEqual({
      route: 'ConsentGate',
      params: { draftId: 'draft-1' },
    });
    expect(getReportWizardProgress(reviewDraft, 'ConsentGate')).toMatchObject({
      completedSteps: 3,
      totalSteps: 4,
      isComplete: false,
      currentStepId: 'review-next-step',
    });

    expect(getNextIncompleteReportStep(buildDraft({
      completedSteps: REPORT_STEPS_BEFORE_CONSENT,
      selectedPathway: 'referral',
    }))).toEqual({ route: 'ConsentGate', params: { draftId: 'draft-1' } });

    expect(getNextIncompleteReportStep(buildDraft({
      completedSteps: [...REPORT_STEPS_BEFORE_CONSENT, 'ReferralPicker'],
      selectedPathway: 'referral',
      referralSelection: {
        providerId: '1195',
        providerName: 'National GBV Toll-Free Helpline',
        providerType: 'Hotline',
        selectedChannel: 'call',
        includeBrief: true,
        serviceScope: ['GBV support'],
        selectedAt: now.toISOString(),
      },
    }))).toEqual({ route: 'ConsentGate', params: { draftId: 'draft-1' } });
  });

  it('allows low-text What Happened completion to resume at Where/When', () => {
    const draft = buildDraft({
      completedSteps: ['WhatHappened'],
      patterns: ['unsafe_transport'],
      impactLevel: 'medium',
    });

    expect(getNextIncompleteReportStep(draft)).toEqual({
      route: 'WhereWhen',
      params: { draftId: 'draft-1' },
    });
    expect(getReportWizardProgress(draft).steps.find(step => step.id === 'what-happened')?.status).toBe('complete');
  });

  it('treats selected incident pattern as the required What Happened data', () => {
    const draft = buildDraft({
      patterns: ['unsafe_transport'],
    });

    expect(getNextIncompleteReportStep(draft)).toEqual({
      route: 'WhereWhen',
      params: { draftId: 'draft-1' },
    });
    expect(getReportWizardProgress(draft, 'WhereWhen').steps.find(step => step.id === 'what-happened')?.status).toBe('complete');
  });

  it('treats location type and datetime as enough Where/When data without exact location', () => {
    const draft = buildDraft({
      completedSteps: ['WhatHappened'],
      location: { type: 'stage_or_stop' },
      datetime: { date: '2026-06-06', time: '09:30', accuracy: 'approximate' },
    });

    expect(getReportWizardProgress(draft).steps.find(step => step.id === 'where-when')?.status).toBe('complete');
    expect(getNextIncompleteReportStep(draft)).toEqual({
      route: 'EvidenceDetail',
      params: { draftId: 'draft-1' },
    });
  });

  it('honors intentional Where/When completion when optional time details are skipped', () => {
    const draft = buildDraft({
      completedSteps: ['WhatHappened', 'WhereWhen'],
      patterns: ['unsafe_transport'],
      location: { type: 'stage_or_stop' },
    });

    expect(getReportWizardProgress(draft).steps.find(step => step.id === 'where-when')?.status).toBe('complete');
    expect(getNextIncompleteReportStep(draft)).toEqual({
      route: 'EvidenceDetail',
      params: { draftId: 'draft-1' },
    });
  });

  it('marks optional evidence as skipped when the user continues without evidence', () => {
    const progress = getReportWizardProgress(buildDraft({
      completedSteps: ['WhatHappened', 'WhereWhen', 'EvidenceDetail'],
      selectedTags: ['harassment'],
    }));

    expect(progress.steps.find(step => step.id === 'evidence')?.status).toBe('skipped');
    expect(progress.nextStep).toEqual({ route: 'ConsentGate', params: { draftId: 'draft-1' } });
  });

  it('builds a skip target past consecutive optional report steps', () => {
    const draft = buildDraft({
      completedSteps: ['WhatHappened', 'WhereWhen'],
    });

    expect(getOptionalReportStepSkipTarget(draft, 'EvidenceDetail')).toEqual({
      target: { route: 'ConsentGate', params: { draftId: 'draft-1' } },
      stepsToComplete: ['EvidenceDetail'],
    });
    expect(getOptionalReportStepSkipTarget(buildDraft(), 'EvidenceDetail')).toBeUndefined();
    expect(getOptionalReportStepSkipTarget(draft, 'WhereWhen')).toBeUndefined();
  });

  it('keeps final review current when the required report steps are done', () => {
    const draft = buildDraft({
      completedSteps: ['WhatHappened', 'WhereWhen', 'EvidenceDetail'],
      currentStep: 'ConsentGate',
    });

    const progress = getReportWizardProgress(draft);

    expect(progress.steps.find(step => step.id === 'evidence')?.status).toBe('skipped');
    expect(progress.steps.find(step => step.id === 'review-next-step')?.status).toBe('current');
    expect(getNextIncompleteReportStep(draft)).toEqual({ route: 'ConsentGate', params: { draftId: 'draft-1' } });
  });

  it('returns the workspace when the report is in a final saved state', () => {
    const draft = buildDraft({
      completedSteps: getSubmittedReportSteps('save-private'),
      selectedPathway: 'save-private',
      currentStep: 'completed',
    });

    expect(getNextIncompleteReportStep(draft)).toBeUndefined();
    expect(getReportWizardResumeTarget(draft)).toEqual({ route: 'DraftOverview', params: { draftId: 'draft-1' } });

    const progress = getReportWizardProgress(draft);
    expect(progress.isComplete).toBe(true);
    expect(progress.steps.at(-1)?.status).toBe('complete');
  });
});
