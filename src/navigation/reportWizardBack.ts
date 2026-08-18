import { useCallback, useEffect, useMemo } from 'react';
import { StackActions } from '@react-navigation/native';

import type { RootStackParamList } from './routes';

type ReportWizardBackRoute =
  | 'WhatHappened'
  | 'WhereWhen'
  | 'EvidenceDetail'
  | 'ConsentGate';

export type ReportWizardBackTarget = {
  [RouteName in ReportWizardBackRoute]: {
    route: RouteName;
    params: RootStackParamList[RouteName];
  };
}[ReportWizardBackRoute];

type NavigationLike = {
  addListener: (eventName: 'beforeRemove', callback: (event: any) => void) => () => void;
  dispatch: (action: any) => void;
  getState: () => { index?: number; routes: Array<{ name: string }> };
  goBack: () => void;
};

function getPreviousRouteName(navigation: NavigationLike): string | undefined {
  const state = navigation.getState();
  const index = typeof state.index === 'number' ? state.index : state.routes.length - 1;
  return index > 0 ? state.routes[index - 1]?.name : undefined;
}

function isBackAction(action: { type?: string } | undefined): boolean {
  return action?.type === 'GO_BACK' || action?.type === 'POP';
}

export function useReportWizardBack(
  navigation: NavigationLike,
  target: ReportWizardBackTarget | undefined,
): () => void {
  const targetRoute = target?.route;
  const targetKey = target ? `${target.route}:${JSON.stringify(target.params)}` : '';
  const targetParams = useMemo(() => target?.params, [targetKey]);

  const goBack = useCallback(() => {
    if (!targetRoute || !targetParams) {
      navigation.goBack();
      return;
    }

    if (getPreviousRouteName(navigation) === targetRoute) {
      navigation.goBack();
      return;
    }

    navigation.dispatch(StackActions.replace(targetRoute, targetParams));
  }, [navigation, targetKey, targetParams, targetRoute]);

  useEffect(() => {
    if (!targetRoute) return undefined;

    return navigation.addListener('beforeRemove', event => {
      if (!isBackAction(event.data?.action)) return;
      if (getPreviousRouteName(navigation) === targetRoute) return;

      event.preventDefault();
      goBack();
    });
  }, [goBack, navigation, targetRoute]);

  return goBack;
}
