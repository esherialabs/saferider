export const PERSISTENCE_KEY = 'NAVIGATION_STATE';

type PersistedRouteParams = {
  draftId?: unknown;
  [key: string]: unknown;
};

export type PersistedNavigationRoute = {
  key?: string;
  name?: string;
  params?: PersistedRouteParams;
  state?: PersistedNavigationState;
  [key: string]: unknown;
};

export type PersistedNavigationState = {
  index?: number;
  routes?: PersistedNavigationRoute[];
  [key: string]: unknown;
};

const SUPPORTED_MAIN_TAB_ROUTES = new Set(['Home', 'Report', 'Support', 'Learn']);

const REPORT_ROUTES_REQUIRING_DRAFT = new Set([
  'DraftOverview',
  'WhereWhen',
  'EvidenceDetail',
  'ConsentGate',
  'ReferralPicker',
  'EscalationForm',
  'StatementReview',
]);

function getActiveRouteIndex(state: PersistedNavigationState, routeCount: number): number {
  if (
    typeof state.index === 'number' &&
    Number.isInteger(state.index) &&
    state.index >= 0 &&
    state.index < routeCount
  ) {
    return state.index;
  }

  return Math.max(0, routeCount - 1);
}

function hasRestorableDraft(route: PersistedNavigationRoute, availableDraftIds: ReadonlySet<string>): boolean {
  return typeof route.params?.draftId === 'string' && availableDraftIds.has(route.params.draftId);
}

function requiresRestorableDraft(route: PersistedNavigationRoute): boolean {
  if (route.name === 'WhatHappened') {
    return typeof route.params?.draftId === 'string';
  }

  return Boolean(route.name && REPORT_ROUTES_REQUIRING_DRAFT.has(route.name));
}

function sanitizeStateRoutes(
  state: PersistedNavigationState,
  availableDraftIds: ReadonlySet<string>,
  options: { fallbackRoute?: PersistedNavigationRoute } = {},
): PersistedNavigationState | undefined {
  const routes = Array.isArray(state.routes) ? state.routes : [];
  if (routes.length === 0) {
    return options.fallbackRoute ? { ...state, index: 0, routes: [options.fallbackRoute] } : undefined;
  }

  const activeRouteIndex = getActiveRouteIndex(state, routes.length);
  let activeRouteReplacement: PersistedNavigationRoute | undefined;
  const sanitizedRoutes: PersistedNavigationRoute[] = [];

  routes.forEach((route, index) => {
    const sanitizedRoute = sanitizeRoute(route, availableDraftIds);
    if (!sanitizedRoute) return;

    sanitizedRoutes.push(sanitizedRoute);
    if (index === activeRouteIndex) {
      activeRouteReplacement = sanitizedRoute;
    }
  });

  if (sanitizedRoutes.length === 0) {
    return options.fallbackRoute ? { ...state, index: 0, routes: [options.fallbackRoute] } : undefined;
  }

  let nextIndex = activeRouteReplacement ? sanitizedRoutes.indexOf(activeRouteReplacement) : -1;
  if (nextIndex < 0) {
    const fallbackIndex = options.fallbackRoute?.name
      ? sanitizedRoutes.findIndex(route => route.name === options.fallbackRoute?.name)
      : -1;
    nextIndex = fallbackIndex >= 0 ? fallbackIndex : 0;
  }

  return {
    ...state,
    index: nextIndex,
    routes: sanitizedRoutes,
  };
}

function sanitizeReportStackState(
  state: PersistedNavigationState,
  availableDraftIds: ReadonlySet<string>,
): PersistedNavigationState {
  return sanitizeStateRoutes(state, availableDraftIds, {
    fallbackRoute: { name: 'ReportHome' },
  }) ?? { ...state, index: 0, routes: [{ name: 'ReportHome' }] };
}

function sanitizeRoute(
  route: PersistedNavigationRoute,
  availableDraftIds: ReadonlySet<string>,
): PersistedNavigationRoute | undefined {
  if (requiresRestorableDraft(route) && !hasRestorableDraft(route, availableDraftIds)) {
    return undefined;
  }

  if (!route.state) {
    return route;
  }

  const nestedState = route.name === 'Report'
    ? sanitizeReportStackState(route.state, availableDraftIds)
    : sanitizeStateRoutes(route.state, availableDraftIds);

  if (!nestedState) {
    return undefined;
  }

  return nestedState === route.state ? route : { ...route, state: nestedState };
}

function hasUnsupportedMainTabRoute(state: PersistedNavigationState): boolean {
  const mainTabsRoute = state.routes?.find((route) => route.name === 'MainTabs');
  const tabRoutes = mainTabsRoute?.state?.routes;

  return Boolean(tabRoutes?.some((route) => route.name && !SUPPORTED_MAIN_TAB_ROUTES.has(route.name)));
}

export function normalizeRestoredNavigationState<State extends PersistedNavigationState | undefined>(
  state: State,
  availableDraftIds: ReadonlySet<string> = new Set<string>(),
): State | undefined {
  if (!state) return undefined;

  if (hasUnsupportedMainTabRoute(state)) {
    return undefined;
  }

  return sanitizeStateRoutes(state, availableDraftIds) as State | undefined;
}
