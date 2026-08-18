import { CommonActions, StackActions } from '@react-navigation/native';
import type { MainTabParamList, ReportStackParamList } from './routes';

export type ReportRouteName = keyof ReportStackParamList;

type NavigationLike = {
  getState?: () => { routeNames?: string[] };
  dispatch?: (action: any) => void;
  navigate: (...args: any[]) => void;
  getParent?: () => NavigationLike | undefined;
};

function ownsRoute(navigation: NavigationLike, routeName: string): boolean {
  try {
    return Boolean(navigation.getState?.().routeNames?.includes(routeName));
  } catch {
    return false;
  }
}

export function navigateToReportRoute<RouteName extends ReportRouteName>(
  navigation: NavigationLike,
  routeName: RouteName,
  params: ReportStackParamList[RouteName],
) {
  if (ownsRoute(navigation, routeName)) {
    navigation.navigate(routeName, params);
    return;
  }

  if (ownsRoute(navigation, 'Report')) {
    navigation.navigate('Report' satisfies keyof MainTabParamList, {
      screen: routeName,
      params,
    });
    return;
  }

  navigation.navigate('MainTabs', {
    screen: 'Report',
    params: {
      screen: routeName,
      params,
    },
  });
}

export function pushReportRoute<RouteName extends ReportRouteName>(
  navigation: NavigationLike,
  routeName: RouteName,
  params: ReportStackParamList[RouteName],
) {
  if (ownsRoute(navigation, routeName) && navigation.dispatch) {
    navigation.dispatch(StackActions.push(routeName, params));
    return;
  }

  navigateToReportRoute(navigation, routeName, params);
}

export function resetReportStackToRoute<RouteName extends ReportRouteName>(
  navigation: NavigationLike,
  routeName: RouteName,
  params: ReportStackParamList[RouteName],
) {
  const reportState = {
    index: 1,
    routes: [
      { name: 'ReportHome' },
      { name: routeName, params },
    ],
  };

  if (ownsRoute(navigation, 'ReportHome') && navigation.dispatch) {
    navigation.dispatch(CommonActions.reset(reportState));
    return;
  }

  if (ownsRoute(navigation, 'Report')) {
    navigation.navigate('Report' satisfies keyof MainTabParamList, {
      state: reportState,
    });
    return;
  }

  navigation.navigate('MainTabs', {
    screen: 'Report',
    params: {
      state: reportState,
    },
  });
}

export function navigateToMainTab(
  navigation: NavigationLike,
  tabName: keyof MainTabParamList = 'Home',
) {
  const parent = navigation.getParent?.();
  if (parent && ownsRoute(parent, tabName)) {
    parent.navigate(tabName);
    return;
  }

  navigation.navigate('MainTabs', { screen: tabName });
}
