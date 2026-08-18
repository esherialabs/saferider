import { MainTabParamList, RootStackParamList } from './routes';
import { normalizeSelectableLanguageCode } from '../config/languageAvailability';

export type MainTabName = keyof MainTabParamList;
export type RootRouteName = keyof RootStackParamList;

export type TabIconName =
  | 'shield-checkmark-outline'
  | 'document-text-outline'
  | 'chatbubbles-outline'
  | 'book-outline';

export interface MainTabShellItem {
  name: MainTabName;
  label: string;
  title: string;
  subtitle: string;
  icon: TabIconName;
}

export const MAIN_TAB_ORDER: MainTabName[] = ['Home', 'Report', 'Support', 'Learn'];

export const MAIN_TAB_SHELL: Record<MainTabName, MainTabShellItem> = {
  Home: {
    name: 'Home',
    label: 'Home',
    title: 'SafeRide',
    subtitle: 'Safety command center',
    icon: 'shield-checkmark-outline',
  },
  Report: {
    name: 'Report',
    label: 'Report',
    title: 'Report',
    subtitle: 'Draft workspace',
    icon: 'document-text-outline',
  },
  Support: {
    name: 'Support',
    label: 'Support',
    title: 'Support',
    subtitle: 'Providers and guidance',
    icon: 'chatbubbles-outline',
  },
  Learn: {
    name: 'Learn',
    label: 'Learn',
    title: 'Learn',
    subtitle: 'Rights, guides and resources',
    icon: 'book-outline',
  },
};

export const MAIN_TAB_SHELL_SW: Record<MainTabName, MainTabShellItem> = {
  Home: {
    name: 'Home',
    label: 'Nyumbani',
    title: 'SafeRide',
    subtitle: 'Kituo cha usalama',
    icon: 'shield-checkmark-outline',
  },
  Report: {
    name: 'Report',
    label: 'Ripoti',
    title: 'Ripoti',
    subtitle: 'Eneo la rasimu',
    icon: 'document-text-outline',
  },
  Support: {
    name: 'Support',
    label: 'Msaada',
    title: 'Msaada',
    subtitle: 'Watoa huduma na mwongozo',
    icon: 'chatbubbles-outline',
  },
  Learn: {
    name: 'Learn',
    label: 'Jifunze',
    title: 'Jifunze',
    subtitle: 'Haki, mwongozo na nyenzo',
    icon: 'book-outline',
  },
};

export function getMainTabShell(languageCode?: string | null): Record<MainTabName, MainTabShellItem> {
  return normalizeSelectableLanguageCode(languageCode) === 'sw' ? MAIN_TAB_SHELL_SW : MAIN_TAB_SHELL;
}

export interface ReportShellStep {
  id: RootRouteName;
  label: string;
  description: string;
}

export const REPORT_SHELL_STEPS: ReportShellStep[] = [
  {
    id: 'WhatHappened',
    label: 'Details',
    description: 'Describe what happened.',
  },
  {
    id: 'WhereWhen',
    label: 'Place',
    description: 'Add location and time.',
  },
  {
    id: 'EvidenceDetail',
    label: 'Evidence',
    description: 'Attach local evidence.',
  },
  {
    id: 'ConsentGate',
    label: 'Review and next step',
    description: 'Review the draft, choose what happens next, and confirm what leaves the device.',
  },
];

export const SUPPORT_OWNED_ROUTES: RootRouteName[] = ['ReferralPicker', 'TipsRights', 'AboutLegal'];
export const SETTINGS_OWNED_ROUTES: RootRouteName[] = [
  'Settings',
  'SafetySettings',
  'PrivacyData',
  'LanguageAccessibility',
  'TestMeasurementConsent',
  'IssueReport',
  'TestSessionSummary',
];
