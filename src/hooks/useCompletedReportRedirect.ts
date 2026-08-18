import { useEffect, useRef } from 'react';

import { isFinalReportDraftState } from '../navigation/reportPathwayFlow';
import type { DraftData } from '../utils/draftStorage';

type NavigationLike = {
  navigate: (...args: any[]) => void;
  getParent?: () => NavigationLike | undefined;
  getState?: () => { routeNames?: string[] };
};

export function useCompletedReportRedirect(
  navigation: NavigationLike,
  draft: DraftData | null | undefined,
  options: { enabled?: boolean } = {},
) {
  const redirectedDraftRef = useRef<string | null>(null);
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled || !draft?.id || !isFinalReportDraftState(draft)) {
      return;
    }

    if (redirectedDraftRef.current === draft.id) {
      return;
    }

    redirectedDraftRef.current = draft.id;
    navigation.navigate('Cases');
  }, [draft, enabled, navigation]);
}
