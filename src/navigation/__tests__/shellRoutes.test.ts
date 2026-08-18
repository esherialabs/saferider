import { describe, expect, it } from 'vitest';

import {
  MAIN_TAB_ORDER,
  MAIN_TAB_SHELL,
  getMainTabShell,
  REPORT_SHELL_STEPS,
  SETTINGS_OWNED_ROUTES,
} from '../shellRoutes';

describe('navigation shell routes', () => {
  it('uses the approved primary tab model', () => {
    expect(MAIN_TAB_ORDER).toEqual(['Home', 'Report', 'Support', 'Learn']);
    expect(Object.keys(MAIN_TAB_SHELL)).toEqual(MAIN_TAB_ORDER);
    expect(MAIN_TAB_ORDER).not.toContain('Chat');
    expect(MAIN_TAB_ORDER).not.toContain('Settings');
    expect(MAIN_TAB_ORDER).not.toContain('Cases');
  });

  it('keeps settings outside the bottom tab bar', () => {
    expect(SETTINGS_OWNED_ROUTES).toContain('Settings');
    expect(MAIN_TAB_ORDER).not.toContain('Settings');
  });

  it('falls back to the source shell for a disabled stored locale', () => {
    expect(getMainTabShell('sw').Support.label).toBe('Support');
    expect(getMainTabShell('sw').Report.subtitle).toBe('Draft workspace');
    expect(getMainTabShell('en').Support.label).toBe('Support');
  });

  it('defines the shared report stepper sequence through consent', () => {
    expect(REPORT_SHELL_STEPS.map((step) => step.id)).toEqual([
      'WhatHappened',
      'WhereWhen',
      'EvidenceDetail',
      'ConsentGate',
    ]);
    expect(REPORT_SHELL_STEPS.at(-1)).toMatchObject({
      id: 'ConsentGate',
      label: 'Review and next step',
    });
  });
});
