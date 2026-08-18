import React from 'react';
import { StyleProp, ViewStyle } from 'react-native';
import { REPORT_SHELL_STEPS, RootRouteName } from '../../navigation/shellRoutes';
import { ProgressStep } from './ProgressStepper';
import {
  AppHeader,
  AppHeaderProps,
  CompactReportHeader,
  ShellScreen,
  ShellScreenProps,
  StickyFooterActions,
  StickyFooterActionsProps,
} from './AppShell';

type TemplateBaseProps = Omit<ShellScreenProps, 'header' | 'footer'> & {
  children: React.ReactNode;
  footerActions?: StickyFooterActionsProps;
  contentStyle?: StyleProp<ViewStyle>;
};

function renderFooter(footerActions?: StickyFooterActionsProps) {
  return footerActions ? <StickyFooterActions {...footerActions} /> : undefined;
}

export interface DashboardTemplateProps extends TemplateBaseProps {
  headerProps?: AppHeaderProps;
}

export function DashboardTemplate({
  children,
  footerActions,
  headerProps,
  ...screenProps
}: DashboardTemplateProps) {
  return (
    <ShellScreen
      {...screenProps}
      header={headerProps ? <AppHeader {...headerProps} /> : undefined}
      footer={renderFooter(footerActions)}
      scrollable={screenProps.scrollable ?? true}
    >
      {children}
    </ShellScreen>
  );
}

export interface ReportStepTemplateProps extends TemplateBaseProps {
  title: string;
  subtitle?: string;
  currentStepId?: RootRouteName;
  steps?: ProgressStep[];
  onQuickExitPress?: () => void;
}

export function ReportStepTemplate({
  children,
  footerActions,
  title,
  subtitle,
  currentStepId,
  steps = REPORT_SHELL_STEPS,
  onQuickExitPress,
  ...screenProps
}: ReportStepTemplateProps) {
  return (
    <ShellScreen
      {...screenProps}
      header={
        <CompactReportHeader
          title={title}
          subtitle={subtitle}
          steps={steps}
          currentStepId={currentStepId}
          onQuickExitPress={onQuickExitPress}
        />
      }
      footer={renderFooter(footerActions)}
      keyboardSafe={screenProps.keyboardSafe ?? true}
      scrollable={screenProps.scrollable ?? true}
    >
      {children}
    </ShellScreen>
  );
}

export function ListDetailTemplate({ children, footerActions, ...screenProps }: TemplateBaseProps) {
  return (
    <ShellScreen {...screenProps} footer={renderFooter(footerActions)} scrollable={screenProps.scrollable ?? true}>
      {children}
    </ShellScreen>
  );
}

export function SettingsTemplate({ children, footerActions, ...screenProps }: TemplateBaseProps) {
  return (
    <ShellScreen {...screenProps} footer={renderFooter(footerActions)} scrollable={screenProps.scrollable ?? true}>
      {children}
    </ShellScreen>
  );
}

export function ChatTemplate({ children, footerActions, ...screenProps }: TemplateBaseProps) {
  return (
    <ShellScreen
      {...screenProps}
      footer={renderFooter(footerActions)}
      keyboardSafe={screenProps.keyboardSafe ?? true}
      scrollable={screenProps.scrollable ?? false}
    >
      {children}
    </ShellScreen>
  );
}

export function ConsentTemplate({ children, footerActions, ...screenProps }: TemplateBaseProps) {
  return (
    <ShellScreen
      {...screenProps}
      footer={renderFooter(footerActions)}
      keyboardSafe={screenProps.keyboardSafe ?? true}
      scrollable={screenProps.scrollable ?? true}
    >
      {children}
    </ShellScreen>
  );
}
