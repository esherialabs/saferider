import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { MainTabParamList, ReportStackParamList } from './routes';
import { MainTabName, getMainTabShell } from './shellRoutes';
import { resetToCalculatorDecoyIfUnlockable } from './quickExitNavigation';

import HomeScreen from '../screens/Home';
import ReportHubScreen from '../screens/ReportHub';
import DraftOverviewScreen from '../screens/DraftOverview';
import EvidenceDetailScreen from '../screens/EvidenceDetail';
import WhatHappenedScreen from '../screens/WhatHappened';
import WhereWhenScreen from '../screens/WhereWhen';
import ConsentGateScreen from '../screens/ConsentGate';
import ReferralPickerScreen from '../screens/ReferralPicker';
import EscalationFormScreen from '../screens/EscalationForm';
import StatementReviewScreen from '../screens/StatementReview';
import ChatLegalAidScreen from '../screens/ChatLegalAid';
import LearnScreen from '../screens/Learn';
import { AppHeader } from '../components/ui/AppShell';
import { useTheme } from '../theme/SimpleThemeProvider';
import { borders, elevation, spacing, typography } from '../theme/tokens';
import { DecoyPinManager } from '../utils/decoyPin';
import { useLanguage } from '../context/LanguageProvider';

const Tab = createBottomTabNavigator<MainTabParamList>();
const ReportStack = createNativeStackNavigator<ReportStackParamList>();

function ReportStackScreen() {
  return (
    <ReportStack.Navigator
      initialRouteName="ReportHome"
      screenOptions={{ headerShown: false }}
    >
      <ReportStack.Screen name="ReportHome" component={ReportHubScreen} />
      <ReportStack.Screen name="DraftOverview" component={DraftOverviewScreen} />
      <ReportStack.Screen name="WhatHappened" component={WhatHappenedScreen} />
      <ReportStack.Screen name="WhereWhen" component={WhereWhenScreen} />
      <ReportStack.Screen name="EvidenceDetail" component={EvidenceDetailScreen} />
      <ReportStack.Screen name="ConsentGate" component={ConsentGateScreen} />
      <ReportStack.Screen name="ReferralPicker" component={ReferralPickerScreen} />
      <ReportStack.Screen name="EscalationForm" component={EscalationFormScreen} />
      <ReportStack.Screen name="StatementReview" component={StatementReviewScreen} />
    </ReportStack.Navigator>
  );
}

export function BottomTabs() {
  const { colors } = useTheme();
  const { languageCode } = useLanguage();
  const decoyPinManager = useMemo(() => DecoyPinManager.getInstance(), []);
  const tabShell = useMemo(() => getMainTabShell(languageCode), [languageCode]);
  const [calculatorUnlockable, setCalculatorUnlockable] = useState(false);

  const refreshCalculatorUnlockable = useCallback(() => {
    let isActive = true;

    decoyPinManager.canUnlockCalculator()
      .then((canUnlock) => {
        if (isActive) setCalculatorUnlockable(canUnlock);
      })
      .catch(() => {
        if (isActive) setCalculatorUnlockable(false);
      });

    return () => {
      isActive = false;
    };
  }, [decoyPinManager]);

  useEffect(() => refreshCalculatorUnlockable(), [refreshCalculatorUnlockable]);
  useFocusEffect(refreshCalculatorUnlockable);

  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={({ route, navigation }) => {
        const tabName = route.name as MainTabName;
        const shell = tabShell[tabName];

        return {
          header: () => (
            <AppHeader
              title={shell.title}
              subtitle={shell.subtitle}
              onSettingsPress={() => (navigation.getParent() as any)?.navigate('Settings')}
              onQuickExitPress={() => {
                void resetToCalculatorDecoyIfUnlockable(navigation, () => decoyPinManager.canUnlockCalculator());
              }}
              showQuickExit={calculatorUnlockable}
            />
          ),
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.textSecondary,
          tabBarLabel: shell.label,
          tabBarLabelStyle: styles.tabLabel,
          tabBarItemStyle: styles.tabItem,
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.divider,
            borderTopWidth: borders.hairline,
            minHeight: 92,
            paddingBottom: spacing.sm,
            paddingHorizontal: spacing.xs,
            paddingTop: spacing.sm,
            ...elevation.card,
          },
          tabBarIcon: ({ color, focused, size }) => (
            <View style={styles.tabIconWrap}>
              <View
                pointerEvents="none"
                style={[
                  styles.activeTabLine,
                  {
                    backgroundColor: focused ? colors.primary : 'transparent',
                  },
                ]}
              />
              <Ionicons name={shell.icon as keyof typeof Ionicons.glyphMap} size={size} color={color} />
            </View>
          ),
        };
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Report" component={ReportStackScreen} />
      <Tab.Screen name="Support" component={ChatLegalAidScreen} />
      <Tab.Screen name="Learn" component={LearnScreen} />
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabLabel: {
    ...typography.labelSmall,
    flexShrink: 0,
    fontWeight: '700',
    lineHeight: typography.labelSmall.lineHeight,
    marginTop: spacing.xxs,
    minHeight: typography.labelSmall.lineHeight,
  },
  tabItem: {
    borderRadius: 0,
    flex: 1,
    minWidth: 0,
    paddingBottom: spacing.xxxs,
    paddingTop: spacing.xxxs,
  },
  tabIconWrap: {
    alignItems: 'center',
    flexShrink: 0,
    justifyContent: 'center',
    marginBottom: spacing.xxs,
    minHeight: 30,
    minWidth: 64,
    position: 'relative',
  },
  activeTabLine: {
    borderRadius: 999,
    height: 3,
    position: 'absolute',
    top: -spacing.xs,
    width: 34,
  },
});
