import { useState, useEffect, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { getDraftUpdateKeys, mergeDraftForLocalPersistence } from '../utils/draftMerge';
import { draftStorage, DraftData } from '../utils/draftStorage';
import { notificationCenter } from '../utils/notificationCenter';
import { devPrivacyError, getPrivacySafeErrorReason } from '../utils/privacyLog';

export { mergeDraftForLocalPersistence } from '../utils/draftMerge';

export interface UseDraftStateOptions {
  autoSave?: boolean;
  autoSaveInterval?: number;
  createIfMissing?: boolean;
  initialStep?: string;
}

export async function persistDraftLocally(draft: DraftData): Promise<DraftData> {
  return draftStorage.saveDraft({
    ...draft,
    updatedAt: new Date(),
  });
}

function hasNewerInMemoryDraft(currentDraft: DraftData | null, persistedFrom: DraftData): boolean {
  return Boolean(
    currentDraft &&
    currentDraft.id === persistedFrom.id &&
    currentDraft.updatedAt.getTime() > persistedFrom.updatedAt.getTime(),
  );
}

export const useDraftState = (
  draftId: string | null | undefined,
  options: UseDraftStateOptions = {}
) => {
  const {
    autoSave = true,
    autoSaveInterval = 30000,
    createIfMissing = false,
    initialStep = 'WhatHappened',
  } = options;
  
  const [draftData, setDraftData] = useState<DraftData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);
  const draftDataRef = useRef<DraftData | null>(null);
  const lastSavedRef = useRef<Date | null>(null);

  useEffect(() => {
    draftDataRef.current = draftData;
  }, [draftData]);

  useEffect(() => {
    lastSavedRef.current = lastSaved;
  }, [lastSaved]);

  const persistLocalSnapshot = useCallback(async (
    draft: DraftData,
    options: { updateState?: boolean; throwOnError?: boolean; explicitKeys?: Set<keyof DraftData> } = {},
  ): Promise<DraftData | null> => {
    const { updateState = true, throwOnError = true } = options;

    try {
      setIsSaving(true);
      setError(null);
      // draftStorage merges against the persisted draft inside its write
      // queue, so this is atomic with respect to writes from other screens.
      // Full in-memory snapshot: only the keys the caller actually edited are
      // explicit; every other field stays protected against stale overwrites.
      const saved = await draftStorage.saveDraft(
        { ...draft, updatedAt: new Date() },
        { explicitKeys: options.explicitKeys ?? new Set() },
      );
      if (!hasNewerInMemoryDraft(draftDataRef.current, saved)) {
        draftDataRef.current = saved;
      }
      if (updateState) {
        setDraftData(current => {
          if (!current || current.id !== saved.id) return current;
          if (hasNewerInMemoryDraft(current, saved)) return current;
          return saved;
        });
      }
      setLastSaved(saved.updatedAt);
      return saved;
    } catch (err) {
      setError('Failed to save draft');
      devPrivacyError('draft state local save failed', { reason: getPrivacySafeErrorReason(err) });
      if (throwOnError) {
        throw err;
      }
      return null;
    } finally {
      setIsSaving(false);
    }
  }, []);

  const flushDraftToLocalStorage = useCallback(async (
    updateUi: boolean = true,
    options: { notifyOnSuccess?: boolean } = {},
  ): Promise<void> => {
    const currentDraft = draftDataRef.current;
    if (!currentDraft || isLoading) return;
    const previousSave = lastSavedRef.current;
    const hadUnsavedChanges = !previousSave || currentDraft.updatedAt.getTime() > previousSave.getTime();

    try {
      // saveDraft is called without any preceding await so the write enters
      // the storage queue in this same tick. A screen that mounts right after
      // this blur flush reads through the queue and sees the flushed data.
      const saved = await draftStorage.saveDraft(
        { ...currentDraft, updatedAt: new Date() },
        { explicitKeys: new Set() },
      );
      if (!hasNewerInMemoryDraft(draftDataRef.current, saved)) {
        draftDataRef.current = saved;
      }
      lastSavedRef.current = saved.updatedAt;
      if (updateUi) {
        setLastSaved(saved.updatedAt);
        setError(null);
      }
      if (options.notifyOnSuccess && hadUnsavedChanges) {
        notificationCenter.notify({
          title: 'Draft saved',
          message: 'Your report is saved on this device.',
          variant: 'success',
        });
      }
    } catch (err) {
      if (updateUi) {
        setError('Failed to save draft');
      }
      devPrivacyError('draft state flush failed', { reason: getPrivacySafeErrorReason(err) });
    }
  }, [isLoading]);
  
  // Load draft data on mount
  useEffect(() => {
    const loadDraft = async () => {
      if (!draftId) {
        draftDataRef.current = null;
        lastSavedRef.current = null;
        setDraftData(null);
        setLastSaved(null);
        setError(null);
        setIsLoading(false);
        return;
      }

      try {
        setIsLoading(true);
        setError(null);
        
        let draft = await draftStorage.getDraft(draftId);
        
        if (!draft) {
          if (!createIfMissing) {
            draftDataRef.current = null;
            lastSavedRef.current = null;
            setDraftData(null);
            setLastSaved(null);
            setError('Local draft not found');
            return;
          }

          const newDraft: DraftData = {
            id: draftId,
            createdAt: new Date(),
            updatedAt: new Date(),
            autoSaveEnabled: autoSave,
            currentStep: initialStep,
            completedSteps: [],
          };
          
          draft = await persistDraftLocally(newDraft);
        }
        
        draftDataRef.current = draft;
        setDraftData(draft);
        setLastSaved(draft.updatedAt);
      } catch (err) {
        setError('Failed to load draft data');
        devPrivacyError('draft state load failed', { reason: getPrivacySafeErrorReason(err) });
      } finally {
        setIsLoading(false);
      }
    };
    
    loadDraft();
  }, [draftId, autoSave, createIfMissing, initialStep]);
  
  // Auto-save functionality
  useEffect(() => {
    if (!autoSave || !draftData || isLoading) return;

    const autoSaveTimer = setTimeout(async () => {
      try {
        const saved = await draftStorage.saveDraft(
          { ...draftData, lastAutoSave: new Date() },
          { explicitKeys: new Set() },
        );
        if (!hasNewerInMemoryDraft(draftDataRef.current, saved)) {
          draftDataRef.current = saved;
        }
        setLastSaved(saved.updatedAt);
      } catch (err) {
        devPrivacyError('draft state autosave failed', { reason: getPrivacySafeErrorReason(err) });
      }
    }, autoSaveInterval);

    return () => clearTimeout(autoSaveTimer);
  }, [draftData, autoSave, autoSaveInterval, isLoading]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState !== 'active') {
        void flushDraftToLocalStorage();
      }
    });

    return () => {
      void flushDraftToLocalStorage(false);
      subscription.remove();
    };
  }, [flushDraftToLocalStorage]);

  const refreshDraftFromLocalStorage = useCallback(async (): Promise<void> => {
    if (!draftId) return;

    try {
      const persisted = await draftStorage.getDraft(draftId);
      if (!persisted) return;

      // Keep the state reference stable when the in-memory draft is already
      // the same age or newer: our own saves emit change events, and swapping
      // in a fresh object here would re-arm the autosave timer forever.
      const current = draftDataRef.current;
      if (
        current?.id === persisted.id &&
        current.updatedAt.getTime() >= persisted.updatedAt.getTime()
      ) {
        if (!lastSavedRef.current || lastSavedRef.current.getTime() < persisted.updatedAt.getTime()) {
          lastSavedRef.current = persisted.updatedAt;
          setLastSaved(persisted.updatedAt);
        }
        return;
      }

      setDraftData(existing => {
        const merged = existing?.id === persisted.id
          ? mergeDraftForLocalPersistence(persisted, existing)
          : persisted;
        draftDataRef.current = merged;
        return merged;
      });
      lastSavedRef.current = persisted.updatedAt;
      setLastSaved(persisted.updatedAt);
      setError(null);
    } catch (err) {
      devPrivacyError('draft state focus refresh failed', { reason: getPrivacySafeErrorReason(err) });
    }
  }, [draftId]);

  useFocusEffect(
    useCallback(() => {
      void refreshDraftFromLocalStorage();

      return () => {
        void flushDraftToLocalStorage(false, { notifyOnSuccess: true });
      };
    }, [flushDraftToLocalStorage, refreshDraftFromLocalStorage]),
  );

  // Refresh from storage whenever another writer (screen, sync, migration)
  // commits a change to this draft, so screens never render a stale snapshot.
  useEffect(() => {
    if (!draftId) return;

    const unsubscribe = draftStorage.subscribe(event => {
      if (event.type === 'save' && event.draftId !== draftId) return;
      if (event.type === 'delete' && event.draftId !== draftId) return;
      void refreshDraftFromLocalStorage();
    });

    return unsubscribe;
  }, [draftId, refreshDraftFromLocalStorage]);

  // Update draft data
  const updateDraft = useCallback(async (
    updates: Partial<DraftData>,
    saveImmediately: boolean = false
  ) => {
    const currentDraft = draftDataRef.current;
    if (!currentDraft) return;

    const updatedDraft = {
      ...currentDraft,
      ...updates,
      updatedAt: new Date(),
    };
    draftDataRef.current = updatedDraft;
    setDraftData(updatedDraft);

    if (saveImmediately) {
      const explicitKeys = getDraftUpdateKeys(updates);
      void persistLocalSnapshot(updatedDraft, { explicitKeys, throwOnError: false });
    }
  }, [persistLocalSnapshot]);

  const saveDraftPatch = useCallback(async (updates: Partial<DraftData>): Promise<DraftData | null> => {
    const currentDraft = draftDataRef.current;
    if (!currentDraft) return null;

    const updatedDraft: DraftData = {
      ...currentDraft,
      ...updates,
      updatedAt: new Date(),
    };

    draftDataRef.current = updatedDraft;
    setDraftData(updatedDraft);

    try {
      setIsSaving(true);
      setError(null);
      const saved = await persistLocalSnapshot(updatedDraft, { explicitKeys: getDraftUpdateKeys(updates) });
      return saved;
    } catch (err) {
      setError('Failed to save draft');
      devPrivacyError('draft state save failed', { reason: getPrivacySafeErrorReason(err) });
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [persistLocalSnapshot]);
  
  // Manual save
  const saveDraft = useCallback(async () => {
    if (!draftData) return;
    
    try {
      setIsSaving(true);
      setError(null);
      const saved = await persistLocalSnapshot(draftData);
      if (saved) {
        setDraftData(saved);
      }
    } catch (err) {
      setError('Failed to save draft');
      devPrivacyError('draft state save failed', { reason: getPrivacySafeErrorReason(err) });
      throw err;
    } finally {
      setIsSaving(false);
    }
  }, [draftData, persistLocalSnapshot]);
  
  // Mark step as completed
  const completeStep = useCallback(async (stepName: string) => {
    const currentDraft = draftDataRef.current;
    if (!currentDraft) return;

    const completedSteps = currentDraft.completedSteps || [];
    if (completedSteps.includes(stepName)) {
      return; // No change needed
    }

    const updatedDraft = {
      ...currentDraft,
      completedSteps: [...completedSteps, stepName],
      currentStep: stepName,
      updatedAt: new Date(),
    };
    draftDataRef.current = updatedDraft;
    setDraftData(updatedDraft);

    const explicitKeys = new Set<keyof DraftData>(['completedSteps', 'currentStep']);
    void persistLocalSnapshot(updatedDraft, { explicitKeys, throwOnError: false });
  }, [persistLocalSnapshot]);
  
  // Update specific section data
  const updateWhatHappened = useCallback((data: {
    incidentPattern?: string;
    incidentDescription?: string;
    impactLevel?: 'low' | 'medium' | 'high';
    followUpAnswers?: Record<string, string>;
  }) => {
    updateDraft(data);
  }, [updateDraft]);
  
  const updateWhereWhen = useCallback((data: {
    location?: DraftData['location'];
    datetime?: DraftData['datetime'];
    duration?: string;
    isOngoing?: boolean;
  }) => {
    updateDraft(data);
  }, [updateDraft]);
  
  const updateEvidence = useCallback((data: {
    mediaFiles?: DraftData['mediaFiles'];
    textEvidence?: string;
    privacySettings?: DraftData['privacySettings'];
  }) => {
    updateDraft(data);
  }, [updateDraft]);
  
  // Delete draft
  const deleteDraft = useCallback(async () => {
    if (!draftId) return;

    try {
      await draftStorage.deleteDraft(draftId);
      draftDataRef.current = null;
      setDraftData(null);
    } catch (err) {
      setError('Failed to delete draft');
      devPrivacyError('draft state delete failed', { reason: getPrivacySafeErrorReason(err) });
      throw err;
    }
  }, [draftId]);
  
  // Get progress information
  const progress = draftData ? draftStorage.getDraftProgress(draftData) : null;
  
  return {
    // State
    draftData,
    isLoading,
    isSaving,
    lastSaved,
    error,
    progress,
    
    // Actions
    updateDraft,
    saveDraftPatch,
    saveDraft,
    deleteDraft,
    completeStep,
    
    // Section-specific updates
    updateWhatHappened,
    updateWhereWhen,
    updateEvidence,
    
    // Utilities
    hasUnsavedChanges: lastSaved ? (draftData?.updatedAt || new Date()) > lastSaved : true,
  };
};

// Hook for managing multiple drafts (for overview screens)
export const useDraftsList = () => {
  const [drafts, setDrafts] = useState<DraftData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const loadDrafts = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const allDrafts = await draftStorage.getAllDrafts();
      setDrafts(allDrafts.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()));
    } catch (err) {
      setError('Failed to load drafts');
      devPrivacyError('draft list load failed', { reason: getPrivacySafeErrorReason(err) });
    } finally {
      setIsLoading(false);
    }
  }, []);
  
  const deleteDraft = useCallback(async (draftId: string) => {
    try {
      await draftStorage.deleteDraft(draftId);
      await loadDrafts(); // Refresh list
    } catch (err) {
      setError('Failed to delete draft');
      devPrivacyError('draft state delete failed', { reason: getPrivacySafeErrorReason(err) });
      throw err;
    }
  }, [loadDrafts]);
  
  const createNewDraft = useCallback(async (): Promise<string> => {
    try {
      const newId = draftStorage.generateDraftId();
      const newDraft: DraftData = {
        id: newId,
        createdAt: new Date(),
        updatedAt: new Date(),
        currentStep: 'WhatHappened',
        completedSteps: [],
        autoSaveEnabled: true,
      };
      
      await draftStorage.saveDraft(newDraft);
      await loadDrafts(); // Refresh list
      return newId;
    } catch (err) {
      setError('Failed to create new draft');
      devPrivacyError('draft creation failed', { reason: getPrivacySafeErrorReason(err) });
      throw err;
    }
  }, [loadDrafts]);
  
  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  // Keep the list in sync with writes made anywhere in the app.
  useEffect(() => draftStorage.subscribe(() => {
    void loadDrafts();
  }), [loadDrafts]);

  return {
    drafts,
    isLoading,
    error,
    loadDrafts,
    deleteDraft,
    createNewDraft,
  };
};
