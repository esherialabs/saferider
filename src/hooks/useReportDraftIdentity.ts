import { useEffect, useState } from 'react';

import { draftStorage } from '../utils/draftStorage';
import { devPrivacyError, getPrivacySafeErrorReason } from '../utils/privacyLog';

type UseReportDraftIdentityOptions = {
  createIfMissing?: boolean;
  initialStep?: string;
  useActiveDraftFallback?: boolean;
};

type ReportDraftIdentityState = {
  draftId: string | null;
  isResolving: boolean;
  error: string | null;
};

export function useReportDraftIdentity(
  routeDraftId: string | undefined,
  options: UseReportDraftIdentityOptions = {},
): ReportDraftIdentityState {
  const {
    createIfMissing = false,
    initialStep = 'WhatHappened',
    useActiveDraftFallback = true,
  } = options;
  const cachedDraftId = routeDraftId ?? (useActiveDraftFallback ? draftStorage.getCachedActiveDraftId() : null);
  const [state, setState] = useState<ReportDraftIdentityState>({
    draftId: cachedDraftId,
    isResolving: Boolean(routeDraftId || useActiveDraftFallback || createIfMissing),
    error: null,
  });

  useEffect(() => {
    let isActive = true;

    const resolveDraftId = async () => {
      try {
        setState(current => ({
          ...current,
          isResolving: true,
          error: null,
        }));

        if (routeDraftId) {
          const existingDraft = await draftStorage.getDraft(routeDraftId);
          if (!existingDraft && !createIfMissing) {
            if (isActive) {
              setState({
                draftId: null,
                isResolving: false,
                error: 'This local draft is no longer available on this phone.',
              });
            }
            return;
          }

          if (!existingDraft && createIfMissing) {
            await draftStorage.saveDraft({
              id: routeDraftId,
              currentStep: initialStep,
              completedSteps: [],
            });
          }

          void draftStorage.setActiveDraftId(routeDraftId);
          if (isActive) {
            setState({ draftId: routeDraftId, isResolving: false, error: null });
          }
          return;
        }

        if (!useActiveDraftFallback) {
          if (!createIfMissing) {
            if (isActive) {
              setState({ draftId: null, isResolving: false, error: null });
            }
            return;
          }

          const nextDraftId = draftStorage.generateDraftId();
          await draftStorage.saveDraft({
            id: nextDraftId,
            currentStep: initialStep,
            completedSteps: [],
          });
          if (isActive) {
            setState({ draftId: nextDraftId, isResolving: false, error: null });
          }
          return;
        }

        const activeDraftId = await draftStorage.getActiveDraftId();
        if (activeDraftId) {
          if (isActive) {
            setState({ draftId: activeDraftId, isResolving: false, error: null });
          }
          return;
        }

        if (!createIfMissing) {
          if (isActive) {
            setState({ draftId: null, isResolving: false, error: 'No local draft is active.' });
          }
          return;
        }

        const nextDraftId = draftStorage.generateDraftId();
        await draftStorage.saveDraft({
          id: nextDraftId,
          currentStep: initialStep,
          completedSteps: [],
        });
        if (isActive) {
          setState({ draftId: nextDraftId, isResolving: false, error: null });
        }
      } catch (error) {
        devPrivacyError('report draft identity resolution failed', {
          reason: getPrivacySafeErrorReason(error),
        });
        if (isActive) {
          setState(current => ({
            draftId: current.draftId,
            isResolving: false,
            error: 'Local draft could not be opened.',
          }));
        }
      }
    };

    void resolveDraftId();

    return () => {
      isActive = false;
    };
  }, [createIfMissing, initialStep, routeDraftId, useActiveDraftFallback]);

  return state;
}
