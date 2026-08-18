import React, { useEffect, useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useOnline } from '../../context/OnlineProvider';
import { useTheme } from '../../theme/SimpleThemeProvider';
import {
  borders,
  elevation,
  layout,
  radii,
  spacing,
  typography,
} from '../../theme/tokens';
import Button, { ButtonProps } from './Button';
import { IconButton } from './IconButton';
import { OfflineBanner } from './SystemStates';
import { ProgressStep, ProgressStepper } from './ProgressStepper';

type SafeAreaEdge = 'top' | 'bottom' | 'left' | 'right';

export interface NetworkStatusBannerProps {
  compact?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function NetworkStatusBanner({ compact = false, style }: NetworkStatusBannerProps) {
  const { isOnline, queueSize, syncNow, syncStatus } = useOnline();
  const statusKey = useMemo(() => `${isOnline}:${queueSize}:${syncStatus}`, [isOnline, queueSize, syncStatus]);
  const [dismissedStatusKey, setDismissedStatusKey] = useState<string | null>(null);

  useEffect(() => {
    setDismissedStatusKey(null);
  }, [statusKey]);

  if ((isOnline && queueSize === 0 && syncStatus !== 'error') || dismissedStatusKey === statusKey) {
    return null;
  }

  const title = !isOnline ? 'Offline mode' : syncStatus === 'error' ? 'Sync needs attention' : 'Items queued';
  const message = !isOnline
    ? 'Drafts and evidence stay on this device. Provider requests and uploads will wait.'
    : syncStatus === 'error'
      ? 'Some queued work could not sync. Try again when your connection is stable.'
      : 'Queued work will send when SafeRide can reach the service.';

  return (
    <OfflineBanner
      title={title}
      message={message}
      queuedCount={queueSize > 0 ? queueSize : undefined}
      onPress={isOnline ? syncNow : undefined}
      onDismiss={() => setDismissedStatusKey(statusKey)}
      compact={compact}
      style={style}
    />
  );
}

export interface AppHeaderProps {
  title: string;
  subtitle?: string;
  onSettingsPress?: () => void;
  onQuickExitPress?: () => void;
  showSettings?: boolean;
  showQuickExit?: boolean;
  withTopInset?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AppHeader({
  title,
  subtitle,
  onSettingsPress,
  onQuickExitPress,
  showSettings = true,
  showQuickExit = true,
  withTopInset = true,
  style,
}: AppHeaderProps) {
  const { colors } = useTheme();
  const { isOnline, queueSize } = useOnline();

  const content = (
    <View
      style={[
        styles.appHeader,
        {
          backgroundColor: colors.background,
          borderBottomColor: colors.divider,
        },
        style,
      ]}
    >
      <View style={styles.headerCopy}>
        <View style={styles.headerTitleRow}>
          <Text
            accessibilityRole="header"
            ellipsizeMode="tail"
            numberOfLines={2}
            style={[styles.headerTitle, { color: colors.foreground }]}
          >
            {title}
          </Text>
          <View
            accessibilityLabel={isOnline ? 'Online' : 'Offline'}
            style={[
              styles.connectionDot,
              { backgroundColor: isOnline ? colors.success : colors.offline },
            ]}
          />
        </View>
        {subtitle ? (
          <Text ellipsizeMode="tail" numberOfLines={2} style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
            {subtitle}
            {queueSize > 0 ? ` - ${queueSize} queued` : ''}
          </Text>
        ) : null}
      </View>
      <View style={styles.headerActions}>
        {showSettings ? (
          <IconButton
            icon="settings-outline"
            accessibilityLabel="Open settings"
            onPress={onSettingsPress}
            variant="ghost"
            size="sm"
          />
        ) : null}
        {showQuickExit ? (
          <IconButton
            icon="calculator-outline"
            accessibilityLabel="Quick exit"
            accessibilityHint="Opens the calculator decoy screen."
            onPress={onQuickExitPress}
            variant="outline"
            size="sm"
          />
        ) : null}
      </View>
    </View>
  );

  if (!withTopInset) {
    return content;
  }

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
      {content}
    </SafeAreaView>
  );
}

export interface CompactReportHeaderProps {
  title: string;
  subtitle?: string;
  steps: ProgressStep[];
  currentStepId?: string;
  onQuickExitPress?: () => void;
  style?: StyleProp<ViewStyle>;
}

export function CompactReportHeader({
  title,
  subtitle,
  steps,
  currentStepId,
  onQuickExitPress,
  style,
}: CompactReportHeaderProps) {
  const { colors } = useTheme();

  return (
    <View
      style={[
        styles.reportHeader,
        {
          backgroundColor: colors.background,
          borderColor: colors.divider,
        },
        style,
      ]}
    >
      <View style={styles.reportHeaderTop}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" numberOfLines={2} style={[styles.reportTitle, { color: colors.foreground }]}>
            {title}
          </Text>
          {subtitle ? (
            <Text numberOfLines={2} style={[styles.headerSubtitle, { color: colors.textSecondary }]}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <IconButton
          icon="calculator-outline"
          accessibilityLabel="Quick exit"
          accessibilityHint="Opens the calculator decoy screen."
          onPress={onQuickExitPress}
          variant="ghost"
          size="sm"
        />
      </View>
      <ProgressStepper steps={steps} currentStepId={currentStepId} />
    </View>
  );
}

export interface ShellScreenProps {
  children: React.ReactNode;
  header?: React.ReactNode;
  footer?: React.ReactNode;
  scrollable?: boolean;
  keyboardSafe?: boolean;
  showNetworkStatus?: boolean;
  networkStatusCompact?: boolean;
  edges?: SafeAreaEdge[];
  contentStyle?: StyleProp<ViewStyle>;
  scrollContentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

export function ShellScreen({
  children,
  header,
  footer,
  scrollable = true,
  keyboardSafe = false,
  showNetworkStatus = true,
  networkStatusCompact = false,
  edges = ['bottom', 'left', 'right'],
  contentStyle,
  scrollContentStyle,
  style,
}: ShellScreenProps) {
  const { colors, colorScheme } = useTheme();

  const content = (
    <>
      {header}
      {scrollable ? (
        <ScrollView
          style={styles.flex}
          contentContainerStyle={[styles.scrollContent, contentStyle, scrollContentStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentInsetAdjustmentBehavior="automatic"
          accessible={false}
        >
          {showNetworkStatus ? <NetworkStatusBanner compact={networkStatusCompact} style={styles.networkBanner} /> : null}
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.staticContent, contentStyle]}>
          {showNetworkStatus ? <NetworkStatusBanner compact={networkStatusCompact} style={styles.networkBanner} /> : null}
          {children}
        </View>
      )}
      {footer ? (
        <View
          style={[
            styles.footerDock,
            {
              backgroundColor: colors.background,
              borderTopColor: colors.divider,
            },
          ]}
        >
          {footer}
        </View>
      ) : null}
    </>
  );

  return (
    <SafeAreaView edges={edges} style={[styles.root, { backgroundColor: colors.canvas }, style]}>
      <StatusBar
        barStyle={colorScheme === 'dark' ? 'light-content' : 'dark-content'}
        backgroundColor={colors.background}
      />
      {keyboardSafe ? (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
          style={styles.flex}
        >
          {content}
        </KeyboardAvoidingView>
      ) : (
        content
      )}
    </SafeAreaView>
  );
}

export interface StickyFooterAction extends Pick<
  ButtonProps,
  'title' | 'onPress' | 'variant' | 'disabled' | 'loading' | 'accessibilityLabel' | 'accessibilityHint'
> {}

export interface StickyFooterActionsProps {
  primaryAction?: StickyFooterAction;
  secondaryAction?: StickyFooterAction;
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function StickyFooterActions({
  primaryAction,
  secondaryAction,
  children,
  style,
}: StickyFooterActionsProps) {
  return (
    <View style={[styles.footerActions, style]}>
      {children}
      {secondaryAction ? <Button {...secondaryAction} variant={secondaryAction.variant ?? 'outline'} fullWidth /> : null}
      {primaryAction ? <Button {...primaryAction} variant={primaryAction.variant ?? 'primary'} fullWidth /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  flex: {
    flex: 1,
  },
  appHeader: {
    alignItems: 'center',
    borderBottomWidth: borders.hairline,
    flexDirection: 'row',
    gap: spacing.md,
    minHeight: 72,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerTitleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    minWidth: 0,
  },
  headerTitle: {
    ...typography.titleLarge,
    flexShrink: 1,
  },
  headerSubtitle: {
    ...typography.caption,
    marginTop: spacing.xxxs,
  },
  connectionDot: {
    borderColor: 'rgba(255,255,255,0.7)',
    borderWidth: 1,
    borderRadius: radii.round,
    height: 10,
    width: 10,
  },
  headerActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xxs,
  },
  reportHeader: {
    borderBottomWidth: borders.standard,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  reportHeaderTop: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  reportTitle: {
    ...typography.titleS,
  },
  scrollContent: {
    gap: spacing.lg,
    paddingBottom: spacing.xxl,
    paddingHorizontal: layout.screenGutter,
    paddingTop: spacing.lg,
  },
  staticContent: {
    flex: 1,
    gap: spacing.lg,
    paddingHorizontal: layout.screenGutter,
    paddingTop: spacing.lg,
  },
  networkBanner: {
    marginBottom: spacing.xs,
  },
  footerDock: {
    borderTopWidth: borders.hairline,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    ...elevation.sheet,
  },
  footerActions: {
    gap: spacing.sm,
    paddingBottom: spacing.sm,
  },
});
