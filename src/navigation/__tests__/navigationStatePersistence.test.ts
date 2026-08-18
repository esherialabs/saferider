import { describe, expect, it } from 'vitest';

import {
  normalizeRestoredNavigationState,
  type PersistedNavigationState,
} from '../navigationStatePersistence';

function buildMainTabsState(reportState: PersistedNavigationState): PersistedNavigationState {
  return {
    index: 0,
    routes: [
      {
        name: 'MainTabs',
        state: {
          index: 1,
          routes: [
            { name: 'Home' },
            { name: 'Report', state: reportState },
            { name: 'Support' },
            { name: 'Learn' },
          ],
        },
      },
    ],
  };
}

describe('normalizeRestoredNavigationState', () => {
  it('resets a restored report stack when the active draft route is missing locally', () => {
    const restored = buildMainTabsState({
      index: 1,
      routes: [
        { name: 'ReportHome' },
        {
          name: 'ConsentGate',
          params: { draftId: 'missing-draft', pathway: 'save-private' },
        },
      ],
    });

    const normalized = normalizeRestoredNavigationState(restored, new Set(['other-draft']));
    const reportState = normalized?.routes?.[0].state?.routes?.[1].state;

    expect(reportState?.index).toBe(0);
    expect(reportState?.routes).toEqual([{ name: 'ReportHome' }]);
  });

  it('keeps a restored report draft route when the draft still exists locally', () => {
    const restored = buildMainTabsState({
      index: 1,
      routes: [
        { name: 'ReportHome' },
        {
          name: 'ConsentGate',
          params: { draftId: 'draft-1', pathway: 'save-private' },
        },
      ],
    });

    const normalized = normalizeRestoredNavigationState(restored, new Set(['draft-1']));
    const reportState = normalized?.routes?.[0].state?.routes?.[1].state;

    expect(reportState?.index).toBe(1);
    expect(reportState?.routes?.[1]).toEqual({
      name: 'ConsentGate',
      params: { draftId: 'draft-1', pathway: 'save-private' },
    });
  });

  it('allows draftless step one restore because no local draft exists before step one data is saved', () => {
    const restored = buildMainTabsState({
      index: 1,
      routes: [
        { name: 'ReportHome' },
        { name: 'WhatHappened' },
      ],
    });

    const normalized = normalizeRestoredNavigationState(restored, new Set());
    const reportState = normalized?.routes?.[0].state?.routes?.[1].state;

    expect(reportState?.index).toBe(1);
    expect(reportState?.routes?.[1]).toEqual({ name: 'WhatHappened' });
  });

  it('drops legacy persisted tab state instead of restoring unknown tabs', () => {
    const restored: PersistedNavigationState = {
      index: 0,
      routes: [
        {
          name: 'MainTabs',
          state: {
            index: 1,
            routes: [
              { name: 'Home' },
              { name: 'Report' },
              { name: 'LegacyChat' },
            ],
          },
        },
      ],
    };

    expect(normalizeRestoredNavigationState(restored, new Set())).toBeUndefined();
  });
});
