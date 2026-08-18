import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import Button from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardTitle } from '../components/ui/Card';
import Screen from '../components/ui/Screen';
import { Switch } from '../components/ui/Switch';
import { useToast } from '../components/ui/Toast';
import { useLanguage } from '../context/LanguageProvider';
import { getModeratedTestCopy } from '../i18n/languageAccessibilityCopy';
import { buildReviewableDiagnostics } from '../lib/measurement/diagnostics';
import {
  ACTUAL_BEHAVIORS,
  EXPECTED_BEHAVIORS,
  ISSUE_CATEGORIES,
  ISSUE_SEVERITIES,
  type IssueReportInput,
} from '../lib/measurement/issueSchema';
import { MEASUREMENT_SCREEN_IDS, MEASUREMENT_TASK_IDS } from '../lib/measurement/eventSchema';
import {
  getMeasurementConsent,
  getMeasurementSession,
  hasCurrentMeasurementAuthorization,
  saveIssueReport,
} from '../lib/measurement/localEventStore';
import { useTheme } from '../theme/SimpleThemeProvider';
import { borders, radii, spacing, touchTargets, typography } from '../theme/tokens';
import { getMeasurementModeDecision } from '../lib/measurement/measurementConfig';

type OptionGroupProps = {
  title: string;
  values: readonly string[];
  selected: string;
  labels: Record<string, string>;
  onSelect: (value: string) => void;
};

function OptionGroup({ title, values, selected, labels, onSelect }: OptionGroupProps) {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="radiogroup" style={{ gap: spacing.xs }}>
      <Text style={[typography.labelLarge, { color: colors.textPrimary }]}>{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs }}>
        {values.map(value => {
          const checked = selected === value;
          return (
            <Pressable
              key={value}
              onPress={() => onSelect(value)}
              accessibilityRole="radio"
              accessibilityState={{ checked }}
              accessibilityLabel={labels[value]}
              style={{
                alignItems: 'center',
                backgroundColor: checked ? colors.primaryMuted : colors.surface,
                borderColor: checked ? colors.primary : colors.divider,
                borderRadius: radii.chip,
                borderWidth: checked ? borders.focus : borders.hairline,
                justifyContent: 'center',
                minHeight: touchTargets.minimum,
                paddingHorizontal: spacing.md,
              }}
            >
              <Text style={[typography.bodyS, { color: colors.textPrimary }]}>{labels[value]}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function IssueReport() {
  const { colors, isHighContrast } = useTheme();
  const { languageCode } = useLanguage();
  const copy = getModeratedTestCopy(languageCode);
  const toast = useToast();
  const decision = useMemo(() => getMeasurementModeDecision(), []);
  const measurementEnabled = decision.enabled;
  const [authorization, setAuthorization] = useState<'checking' | 'allowed' | 'blocked'>('checking');
  const [category, setCategory] = useState<typeof ISSUE_CATEGORIES[number]>('navigation');
  const [screenId, setScreenId] = useState<typeof MEASUREMENT_SCREEN_IDS[number]>('home');
  const [taskId, setTaskId] = useState<typeof MEASUREMENT_TASK_IDS[number]>('report-flow');
  const [severity, setSeverity] = useState<typeof ISSUE_SEVERITIES[number]>('medium');
  const [expectedBehavior, setExpectedBehavior] = useState<typeof EXPECTED_BEHAVIORS[number]>('task_completes');
  const [actualBehavior, setActualBehavior] = useState<typeof ACTUAL_BEHAVIORS[number]>('control_unresponsive');
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [busy, setBusy] = useState(false);
  const diagnostics = useMemo(() => buildReviewableDiagnostics({
    featureFlags: [
      ...(isHighContrast ? ['high-contrast' as const] : []),
      ...(measurementEnabled ? ['measurement-banner-visible' as const] : []),
    ],
  }), [isHighContrast, measurementEnabled]);
  const selectors = copy.selectors;

  useEffect(() => {
    if (!decision.enabled) {
      setAuthorization('blocked');
      return;
    }
    let active = true;
    void Promise.all([getMeasurementConsent(), getMeasurementSession()])
      .then(([consent, session]) => {
        if (active) {
          setAuthorization(hasCurrentMeasurementAuthorization(decision, consent, session) ? 'allowed' : 'blocked');
        }
      })
      .catch(() => {
        if (active) setAuthorization('blocked');
      });
    return () => { active = false; };
  }, [decision]);

  const handleSave = async () => {
    if (busy || authorization !== 'allowed') return;
    setBusy(true);
    const input: IssueReportInput = {
      category,
      screenId,
      taskId,
      severity,
      expectedBehavior,
      actualBehavior,
      ...(includeDiagnostics ? { diagnostics, diagnosticsReviewed: true as const } : {}),
    };
    try {
      await saveIssueReport(input);
      toast.show({ title: copy.saved, message: copy.retention, variant: 'success' });
    } catch {
      toast.show({ title: copy.saveFailed, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const styles = StyleSheet.create({
    content: { padding: spacing.md, paddingBottom: 96, gap: spacing.md },
    diagnostic: { ...typography.bodyS, color: colors.textSecondary },
  });

  return (
    <Screen scrollable>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={[typography.headlineSmall, { color: colors.textPrimary }]}>{copy.issueTitle}</Text>
        <Text style={[typography.bodyM, { color: colors.textSecondary }]}>{copy.issueBody}</Text>

        {authorization !== 'allowed' ? (
          <Card variant="outlined" hideAccent>
            <CardContent style={{ gap: spacing.sm, padding: spacing.md }}>
              <CardTitle>{copy.disabledTitle}</CardTitle>
              <CardDescription>{copy.disabledBody}</CardDescription>
            </CardContent>
          </Card>
        ) : null}

        {authorization === 'allowed' ? (
          <>
        <OptionGroup title={selectors.categoryTitle} values={ISSUE_CATEGORIES} selected={category} labels={selectors.categories} onSelect={value => setCategory(value as typeof category)} />
        <OptionGroup title={selectors.screenTitle} values={MEASUREMENT_SCREEN_IDS} selected={screenId} labels={selectors.screens} onSelect={value => setScreenId(value as typeof screenId)} />
        <OptionGroup title={selectors.taskTitle} values={MEASUREMENT_TASK_IDS} selected={taskId} labels={selectors.tasks} onSelect={value => setTaskId(value as typeof taskId)} />
        <OptionGroup title={selectors.severityTitle} values={ISSUE_SEVERITIES} selected={severity} labels={selectors.severities} onSelect={value => setSeverity(value as typeof severity)} />
        <OptionGroup title={selectors.expectedTitle} values={EXPECTED_BEHAVIORS} selected={expectedBehavior} labels={selectors.expectedBehaviors} onSelect={value => setExpectedBehavior(value as typeof expectedBehavior)} />
        <OptionGroup title={selectors.actualTitle} values={ACTUAL_BEHAVIORS} selected={actualBehavior} labels={selectors.actualBehaviors} onSelect={value => setActualBehavior(value as typeof actualBehavior)} />

        <Card variant="outlined" hideAccent>
          <CardContent style={{ gap: spacing.sm, padding: spacing.md }}>
            <CardTitle>{copy.diagnosticsTitle}</CardTitle>
            <CardDescription>{copy.diagnosticsBody}</CardDescription>
            <Text style={styles.diagnostic}>App: {diagnostics.appVersion}</Text>
            <Text style={styles.diagnostic}>Device tier: {diagnostics.deviceTier}</Text>
            <Text style={styles.diagnostic}>Android: {diagnostics.androidVersion}</Text>
            <Text style={styles.diagnostic}>Flags: {diagnostics.featureFlags.join(', ') || 'none'}</Text>
            <Switch
              value={includeDiagnostics}
              onValueChange={setIncludeDiagnostics}
              label={copy.includeDiagnostics}
              accessibilityHint={copy.diagnosticsBody}
            />
          </CardContent>
        </Card>

        <Button title={copy.saveIssue} onPress={handleSave} loading={busy} fullWidth />
        <Text style={[typography.caption, { color: colors.textSecondary }]}>{copy.retention}</Text>
          </>
        ) : null}
      </View>
    </Screen>
  );
}
