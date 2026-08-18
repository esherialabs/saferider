import AsyncStorage from '@react-native-async-storage/async-storage';
import { describe, expect, it, vi } from 'vitest';

import { isEncryptedAsyncStorageEnvelope } from '../../lib/encryptedAsyncStorage';
import type { DraftData } from '../../utils/draftStorage';
import { localDraftDatabase } from '../../utils/localDraftDatabase';
import { mergeDraftForLocalPersistence, persistDraftLocally } from '../useDraftState';

vi.mock('react-native', () => ({
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  Platform: {
    OS: 'android',
  },
}));

vi.mock('@react-navigation/native', () => ({
  useFocusEffect: vi.fn(),
}));

function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    id: 'draft-local-only',
    createdAt: new Date('2026-07-05T07:00:00.000Z'),
    updatedAt: new Date('2026-07-05T07:00:00.000Z'),
    currentStep: 'WhatHappened',
    completedSteps: ['WhatHappened'],
    incidentDescription: 'Private draft text stays on this phone.',
    ...overrides,
  };
}

describe('useDraftState local draft persistence', () => {
  it('persists drafts to local storage without creating API sync queue work', async () => {
    const saved = await persistDraftLocally(buildDraft());

    expect(saved).toMatchObject({
      id: 'draft-local-only',
      incidentDescription: 'Private draft text stays on this phone.',
    });

    await expect(AsyncStorage.getItem('incident_drafts')).resolves.toBeNull();
    const rawDraft = await localDraftDatabase.getDraftRow('draft-local-only');
    expect(isEncryptedAsyncStorageEnvelope(rawDraft?.encrypted_payload ?? null)).toBe(true);
    expect(rawDraft?.encrypted_payload).not.toContain('Private draft text stays on this phone.');
    await expect(AsyncStorage.getItem('@sync_queue')).resolves.toBeNull();
  });

  it('preserves completed report progress when a reused screen saves a partial draft', () => {
    const persisted = buildDraft({
      patterns: ['verbal_harassment'],
      completedSteps: ['WhatHappened'],
      currentStep: 'WhereWhen',
    });
    const staleScreenDraft = buildDraft({
      patterns: [],
      completedSteps: [],
      currentStep: 'EvidenceDetail',
      location: { type: 'stage_or_stop' },
    });

    const merged = mergeDraftForLocalPersistence(
      persisted,
      staleScreenDraft,
      new Set(['location', 'currentStep']),
    );

    expect(merged.patterns).toEqual(['verbal_harassment']);
    expect(merged.completedSteps).toEqual(['WhatHappened']);
    expect(merged.location).toEqual({ type: 'stage_or_stop' });
    expect(merged.currentStep).toBe('EvidenceDetail');
  });

  it('allows explicit incident updates to replace the saved pattern list', () => {
    const persisted = buildDraft({
      patterns: ['verbal_harassment'],
      completedSteps: ['WhatHappened'],
    });
    const editedDraft = buildDraft({
      patterns: ['unsafe_transport'],
      completedSteps: ['WhatHappened'],
    });

    const merged = mergeDraftForLocalPersistence(
      persisted,
      editedDraft,
      new Set(['patterns']),
    );

    expect(merged.patterns).toEqual(['unsafe_transport']);
  });
});
