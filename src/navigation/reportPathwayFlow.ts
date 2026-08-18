import { PathwayType } from '../types/pathways';
import type { DraftData } from '../utils/draftStorage';
import { RootStackParamList } from './routes';

export type ReportStepName =
  | 'WhatHappened'
  | 'WhereWhen'
  | 'EvidenceDetail'
  | 'ReferralPicker'
  | 'EscalationForm'
  | 'ConsentGate';

export type ReportWizardStepId =
  | 'what-happened'
  | 'where-when'
  | 'evidence'
  | 'completion'
  | 'review-next-step';

export type ReportWizardStepStatus = 'complete' | 'current' | 'upcoming' | 'skipped';

type ReportWizardRouteName =
  | 'DraftOverview'
  | 'WhatHappened'
  | 'WhereWhen'
  | 'EvidenceDetail'
  | 'ReferralPicker'
  | 'EscalationForm'
  | 'ConsentGate';

type ReportWizardStepDefinition = {
  id: ReportWizardStepId;
  label: string;
  description: string;
  route?: Exclude<ReportWizardRouteName, 'DraftOverview'>;
  stepName?: ReportStepName;
  optional?: boolean;
  conditionalPathway?: Extract<PathwayType, 'referral' | 'escalate'>;
};

export type ReportWizardDetailStep = ReportWizardStepDefinition & {
  status: ReportWizardStepStatus;
};

export type ReportWizardStep = ReportWizardStepDefinition & {
  status: ReportWizardStepStatus;
  details?: ReportWizardDetailStep[];
};

export type ReportWizardResumeTarget =
  | { route: 'DraftOverview'; params: RootStackParamList['DraftOverview'] }
  | { route: 'WhatHappened'; params: RootStackParamList['WhatHappened'] }
  | { route: 'WhereWhen'; params: RootStackParamList['WhereWhen'] }
  | { route: 'EvidenceDetail'; params: RootStackParamList['EvidenceDetail'] }
  | { route: 'ReferralPicker'; params: RootStackParamList['ReferralPicker'] }
  | { route: 'EscalationForm'; params: RootStackParamList['EscalationForm'] }
  | { route: 'ConsentGate'; params: RootStackParamList['ConsentGate'] };

export type ReportWizardOptionalSkipTarget = {
  target: ReportWizardResumeTarget;
  stepsToComplete: ReportStepName[];
};

export type ReportWizardProgress = {
  steps: ReportWizardStep[];
  completedSteps: number;
  totalSteps: number;
  percentage: number;
  currentStepId?: ReportWizardStepId;
  nextStep?: ReportWizardResumeTarget;
  isComplete: boolean;
};

export const REPORT_WIZARD_STEP_MODEL: ReportWizardStepDefinition[] = [
  {
    id: 'what-happened',
    route: 'WhatHappened',
    stepName: 'WhatHappened',
    label: 'What happened',
    description: 'Start with the pattern, a brief note, impact, and immediate safety needs.',
  },
  {
    id: 'where-when',
    route: 'WhereWhen',
    stepName: 'WhereWhen',
    label: 'Place and time',
    description: 'Add a safe place clue, then optional timing if you remember it.',
  },
  {
    id: 'evidence',
    route: 'EvidenceDetail',
    stepName: 'EvidenceDetail',
    label: 'Evidence',
    description: 'Optional files, audio, text notes, and evidence status.',
    optional: true,
  },
  {
    id: 'review-next-step',
    route: 'ConsentGate',
    stepName: 'ConsentGate',
    label: 'Review and next step',
    description: 'Review the draft, choose what happens next, and confirm only what should leave the phone.',
  },
];

const REPORT_WIZARD_ROUTE_STEP_MODEL: ReportWizardStepDefinition[] = [
  {
    id: 'what-happened',
    route: 'WhatHappened',
    stepName: 'WhatHappened',
    label: 'What happened',
    description: 'Incident pattern, description, impact, and immediate safety needs.',
  },
  {
    id: 'where-when',
    route: 'WhereWhen',
    stepName: 'WhereWhen',
    label: 'Place and time',
    description: 'General place, optional time, duration, and context.',
  },
  {
    id: 'evidence',
    route: 'EvidenceDetail',
    stepName: 'EvidenceDetail',
    label: 'Evidence',
    description: 'Optional files, audio, text notes, and evidence status.',
    optional: true,
  },
  {
    id: 'review-next-step',
    route: 'ConsentGate',
    stepName: 'ConsentGate',
    label: 'Review and next step',
    description: 'Final review, pathway choice, and consent if something leaves the phone.',
  },
  {
    id: 'completion',
    label: 'Saved state',
    description: 'Local save, queued submission, or submitted case state.',
  },
];

const REPORT_PROGRESS_STEP_GROUPS: Record<
  'what-happened' | 'where-when' | 'evidence' | 'review-next-step',
  ReportWizardStepId[]
> = {
  'what-happened': ['what-happened'],
  'where-when': ['where-when'],
  evidence: ['evidence'],
  'review-next-step': [
    'review-next-step',
    'completion',
  ],
};

type ReportPathwayFlowStep = {
  route: 'ConsentGate' | 'ReferralPicker' | 'EscalationForm';
  requiresNetwork: boolean;
  queuesOffline: boolean;
  currentStep: 'ConsentGate' | 'ReferralPicker' | 'EscalationForm';
};

export const REPORT_STEPS_BEFORE_CONSENT: ReportStepName[] = [
  'WhatHappened',
  'WhereWhen',
  'EvidenceDetail',
];

export const REPORT_PATHWAY_FLOW = {
  'save-private': {
    route: 'ConsentGate',
    requiresNetwork: false,
    queuesOffline: false,
    currentStep: 'ConsentGate',
  },
  'anonymous-map': {
    route: 'ConsentGate',
    requiresNetwork: false,
    queuesOffline: false,
    currentStep: 'ConsentGate',
  },
  referral: {
    route: 'ReferralPicker',
    requiresNetwork: false,
    queuesOffline: false,
    currentStep: 'ReferralPicker',
  },
  escalate: {
    route: 'EscalationForm',
    requiresNetwork: false,
    queuesOffline: false,
    currentStep: 'EscalationForm',
  },
} satisfies Record<PathwayType, ReportPathwayFlowStep>;

export function isReportPathwayOfflineAvailable(pathway: PathwayType): boolean {
  return !REPORT_PATHWAY_FLOW[pathway].requiresNetwork;
}

export function canUseReportPathway(pathway: PathwayType, isOnline: boolean): boolean {
  const flow = REPORT_PATHWAY_FLOW[pathway];
  return isOnline || !flow.requiresNetwork || flow.queuesOffline;
}

export function getCompletedStepsBeforeConsent(pathway: PathwayType): ReportStepName[] {
  switch (pathway) {
    case 'referral':
      return [...REPORT_STEPS_BEFORE_CONSENT, 'ReferralPicker'];
    case 'escalate':
      return [...REPORT_STEPS_BEFORE_CONSENT, 'EscalationForm'];
    default:
      return [...REPORT_STEPS_BEFORE_CONSENT];
  }
}

export function getSubmittedReportSteps(pathway: PathwayType): ReportStepName[] {
  return [...getCompletedStepsBeforeConsent(pathway), 'ConsentGate'];
}


function isPathwayType(value: unknown): value is PathwayType {
  return value === 'save-private' ||
    value === 'anonymous-map' ||
    value === 'referral' ||
    value === 'escalate';
}

function normalizeDraftPathway(draft?: DraftData | null): PathwayType | undefined {
  return isPathwayType(draft?.selectedPathway) ? draft.selectedPathway : undefined;
}

function hasCompletedStep(draft: DraftData | null | undefined, stepName?: ReportStepName): boolean {
  if (!draft || !stepName) return false;
  return Array.isArray(draft.completedSteps) && draft.completedSteps.includes(stepName);
}

function hasText(value?: string | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasEvidence(draft?: DraftData | null): boolean {
  return Boolean(
    (draft?.mediaFiles?.length ?? 0) > 0 ||
    hasText(draft?.textEvidence),
  );
}

function hasWhatHappenedData(draft?: DraftData | null): boolean {
  return (draft?.patterns?.length ?? 0) > 0;
}

function hasWhereWhenData(draft?: DraftData | null): boolean {
  return Boolean(
    hasCompletedStep(draft, 'WhereWhen') ||
    (
      draft?.datetime &&
      (
        hasText(draft.location?.address) ||
        hasText(draft.location?.description) ||
        hasText(draft.location?.type) ||
        Boolean(draft.location?.coordinates)
      )
    ),
  );
}

export function isFinalReportDraftState(draft?: DraftData | null): boolean {
  return draft?.currentStep === 'completed' ||
    draft?.currentStep === 'submitted' ||
    draft?.currentStep === 'queued' ||
    draft?.status === 'queued' ||
    draft?.status === 'submitted' ||
    draft?.status === 'closed';
}

function hasStepData(draft: DraftData | null | undefined, step: ReportWizardStepDefinition): boolean {
  switch (step.id) {
    case 'what-happened':
      return hasCompletedStep(draft, step.stepName) || hasWhatHappenedData(draft);
    case 'where-when':
      return hasCompletedStep(draft, step.stepName) || hasWhereWhenData(draft);
    case 'evidence':
      return hasCompletedStep(draft, step.stepName) || hasEvidence(draft);
    case 'completion':
      return isFinalReportDraftState(draft);
    case 'review-next-step':
      return isFinalReportDraftState(draft);
  }
}

function hasOptionalStepContent(draft: DraftData | null | undefined, step: ReportWizardStepDefinition): boolean {
  switch (step.id) {
    case 'evidence':
      return hasEvidence(draft);
    default:
      return hasStepData(draft, step);
  }
}

function routeToRouteStepId(route?: ReportWizardRouteName | string): ReportWizardStepId | undefined {
  switch (route) {
    case 'WhatHappened':
      return 'what-happened';
    case 'WhereWhen':
      return 'where-when';
    case 'EvidenceDetail':
      return 'evidence';
    case 'ReferralPicker':
      return 'review-next-step';
    case 'EscalationForm':
      return 'review-next-step';
    case 'ConsentGate':
      return 'review-next-step';
    case 'DraftOverview':
      return 'completion';
    default:
      return undefined;
  }
}

function routeToProgressStepId(route?: ReportWizardRouteName | string): ReportWizardStepId | undefined {
  switch (route) {
    case 'WhatHappened':
      return 'what-happened';
    case 'WhereWhen':
      return 'where-when';
    case 'EvidenceDetail':
      return 'evidence';
    case 'ReferralPicker':
    case 'EscalationForm':
    case 'ConsentGate':
    case 'DraftOverview':
      return 'review-next-step';
    default:
      return undefined;
  }
}

function shouldIncludeWizardStep(
  step: ReportWizardStepDefinition,
  draft?: DraftData | null,
  currentRoute?: ReportWizardRouteName | string,
): boolean {
  if (!step.conditionalPathway) return true;
  const pathway = normalizeDraftPathway(draft);
  return pathway === step.conditionalPathway || routeToRouteStepId(currentRoute) === step.id;
}

function hasProgressAfterStep(
  steps: ReportWizardStepDefinition[],
  draft: DraftData | null | undefined,
  stepId: ReportWizardStepId,
): boolean {
  const index = steps.findIndex(step => step.id === stepId);
  if (index < 0) return false;
  return steps.slice(index + 1).some(step => hasStepData(draft, step));
}

function getStepStatus(
  steps: ReportWizardStepDefinition[],
  draft: DraftData | null | undefined,
  step: ReportWizardStepDefinition,
  currentStepId?: ReportWizardStepId,
): ReportWizardStepStatus {
  if (currentStepId === step.id && !isFinalReportDraftState(draft)) {
    return 'current';
  }

  if (step.optional && !hasOptionalStepContent(draft, step) && hasCompletedStep(draft, step.stepName)) {
    return 'skipped';
  }

  if (step.optional && !hasStepData(draft, step) && hasProgressAfterStep(steps, draft, step.id)) {
    return 'skipped';
  }

  if (hasStepData(draft, step)) {
    return 'complete';
  }

  return 'upcoming';
}

function buildTargetForStep(
  draftId: string,
  step: ReportWizardStepDefinition,
  draft?: DraftData | null,
): ReportWizardResumeTarget | undefined {
  switch (step.route) {
    case 'WhatHappened':
      return { route: 'WhatHappened', params: { draftId } };
    case 'WhereWhen':
      return { route: 'WhereWhen', params: { draftId } };
    case 'EvidenceDetail':
      return { route: 'EvidenceDetail', params: { draftId } };
    case 'ReferralPicker':
      return { route: 'ReferralPicker', params: { draftId } };
    case 'EscalationForm':
      return { route: 'EscalationForm', params: { draftId } };
    case 'ConsentGate': {
      // Step 4 is one canonical review screen. The selected pathway lives in
      // the local draft so the URL cannot drift from the visible choice.
      return { route: 'ConsentGate', params: { draftId } };
    }
    default:
      return undefined;
  }
}

export function getActiveReportWizardSteps(
  draft?: DraftData | null,
  currentRoute?: ReportWizardRouteName | string,
): ReportWizardStepDefinition[] {
  return REPORT_WIZARD_ROUTE_STEP_MODEL.filter(step => shouldIncludeWizardStep(step, draft, currentRoute));
}

export function getNextIncompleteReportStep(draft: DraftData): ReportWizardResumeTarget | undefined {
  if (isFinalReportDraftState(draft)) {
    return undefined;
  }

  const steps = getActiveReportWizardSteps(draft);
  for (const step of steps) {
    if (step.id === 'completion') continue;
    if (!hasStepData(draft, step)) {
      return buildTargetForStep(draft.id, step, draft);
    }
  }
  return undefined;
}

export function getOptionalReportStepSkipTarget(
  draft: DraftData | null | undefined,
  currentRoute?: ReportWizardRouteName | string,
): ReportWizardOptionalSkipTarget | undefined {
  if (!draft) return undefined;

  const currentRouteStepId = routeToRouteStepId(currentRoute);
  if (!currentRouteStepId) return undefined;

  const steps = getActiveReportWizardSteps(draft, currentRoute);
  const startIndex = steps.findIndex(step => step.id === currentRouteStepId);
  const currentStep = steps[startIndex];
  if (startIndex < 0 || !currentStep?.optional) return undefined;

  const hasRequiredProgress = steps
    .slice(0, startIndex)
    .filter(step => step.id !== 'completion')
    .every(step => hasStepData(draft, step));
  if (!hasRequiredProgress) return undefined;

  const stepsToComplete: ReportStepName[] = [];

  for (let index = startIndex; index < steps.length; index += 1) {
    const step = steps[index];

    if (step.id === 'completion') continue;

    if (step.optional) {
      if (step.stepName && !stepsToComplete.includes(step.stepName)) {
        stepsToComplete.push(step.stepName);
      }
      continue;
    }

    const target = buildTargetForStep(draft.id, step, draft);
    return target ? { target, stepsToComplete } : undefined;
  }

  return undefined;
}

export function getReportWizardResumeTarget(draft: DraftData): ReportWizardResumeTarget {
  return getNextIncompleteReportStep(draft) ?? {
    route: 'DraftOverview',
    params: { draftId: draft.id },
  };
}

type ReportProgressStepId = keyof typeof REPORT_PROGRESS_STEP_GROUPS;

function isProgressStepId(stepId: ReportWizardStepId): stepId is ReportProgressStepId {
  return stepId in REPORT_PROGRESS_STEP_GROUPS;
}

function getProgressStepStatus(
  step: ReportWizardStepDefinition,
  details: ReportWizardDetailStep[],
  currentStepId?: ReportWizardStepId,
  draft?: DraftData | null,
): ReportWizardStepStatus {
  if (isFinalReportDraftState(draft)) {
    return 'complete';
  }

  if (currentStepId === step.id) {
    return 'current';
  }

  if (details.length === 0) {
    return 'upcoming';
  }

  if (details.some(detail => detail.status === 'current')) {
    return 'current';
  }

  if (details.every(detail => detail.status === 'complete' || detail.status === 'skipped')) {
    return step.optional && details.some(detail => detail.status === 'skipped') ? 'skipped' : 'complete';
  }

  if (details.some(detail => detail.status === 'complete' || detail.status === 'skipped')) {
    return 'current';
  }

  return 'upcoming';
}

export function getReportWizardProgress(
  draft?: DraftData | null,
  currentRoute?: ReportWizardRouteName | string,
): ReportWizardProgress {
  const routeSteps = getActiveReportWizardSteps(draft, currentRoute);
  const currentRouteStepId = routeToRouteStepId(currentRoute) ?? routeToRouteStepId(draft?.currentStep);
  const currentStepId = routeToProgressStepId(currentRoute) ?? routeToProgressStepId(draft?.currentStep);
  const resolvedDetailSteps: ReportWizardDetailStep[] = routeSteps.map(step => ({
    ...step,
    status: getStepStatus(routeSteps, draft, step, currentRouteStepId),
  }));
  const detailStepsById = new Map(resolvedDetailSteps.map(step => [step.id, step]));
  const resolvedSteps = REPORT_WIZARD_STEP_MODEL.map(step => {
    const detailIds = isProgressStepId(step.id) ? REPORT_PROGRESS_STEP_GROUPS[step.id] : [];
    const details = detailIds
      .map(detailId => detailStepsById.get(detailId))
      .filter(Boolean) as ReportWizardDetailStep[];

    return {
      ...step,
      details,
      status: getProgressStepStatus(step, details, currentStepId, draft),
    };
  });
  const completedSteps = resolvedSteps.filter(step => step.status === 'complete' || step.status === 'skipped').length;
  const totalSteps = resolvedSteps.length;
  const percentage = totalSteps === 0 ? 0 : Math.round((completedSteps / totalSteps) * 100);
  const nextStep = draft ? getNextIncompleteReportStep(draft) : undefined;

  return {
    steps: resolvedSteps,
    completedSteps,
    totalSteps,
    percentage,
    currentStepId,
    nextStep,
    isComplete: Boolean(draft && !nextStep && isFinalReportDraftState(draft)),
  };
}

export type ReportPathwayDestination =
  | { route: 'ConsentGate'; params: RootStackParamList['ConsentGate'] }
  | { route: 'ReferralPicker'; params: RootStackParamList['ReferralPicker'] }
  | { route: 'EscalationForm'; params: RootStackParamList['EscalationForm'] };

export function getReportPathwayDestination(
  pathway: PathwayType,
  draftId: string,
): ReportPathwayDestination {
  const flow = REPORT_PATHWAY_FLOW[pathway];

  switch (flow.route) {
    case 'ConsentGate':
      return { route: 'ConsentGate', params: { draftId } };
    case 'ReferralPicker':
      return { route: 'ReferralPicker', params: { draftId } };
    case 'EscalationForm':
      return { route: 'EscalationForm', params: { draftId } };
  }
}
