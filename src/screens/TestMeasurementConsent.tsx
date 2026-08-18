import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { Alert, AlertDescription, AlertTitle } from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardTitle } from '../components/ui/Card';
import Screen from '../components/ui/Screen';
import { useToast } from '../components/ui/Toast';
import { useLanguage } from '../context/LanguageProvider';
import { getModeratedTestCopy } from '../i18n/languageAccessibilityCopy';
import {
  captureMeasurementEvent,
  getMeasurementConsent,
  grantMeasurementConsent,
  withdrawMeasurementConsent,
  type MeasurementConsentRecord,
} from '../lib/measurement/localEventStore';
import { getMeasurementModeDecision } from '../lib/measurement/measurementConfig';
import type { RootStackParamList } from '../navigation/routes';
import { useTheme } from '../theme/SimpleThemeProvider';
import { spacing, typography } from '../theme/tokens';

type Navigation = NativeStackNavigationProp<RootStackParamList>;

export default function TestMeasurementConsent() {
  const navigation = useNavigation<Navigation>();
  const { colors } = useTheme();
  const { languageCode } = useLanguage();
  const copy = getModeratedTestCopy(languageCode);
  const toast = useToast();
  const decision = useMemo(() => getMeasurementModeDecision(), []);
  const [consent, setConsent] = useState<MeasurementConsentRecord | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getMeasurementConsent().then(setConsent).catch(() => {
      toast.show({ title: copy.loadFailed, variant: 'error' });
    });
  }, [copy.loadFailed, toast]);

  const granted = decision.enabled && consent?.status === 'granted' &&
    consent.controlVersion === decision.controls.controlVersion &&
    consent.consentVersion === decision.controls.consent.requiredVersion;

  const handleGrant = async () => {
    if (!decision.enabled || busy) return;
    setBusy(true);
    try {
      const next = await grantMeasurementConsent({ decision });
      setConsent(next);
      captureMeasurementEvent({
        name: 'consent_review',
        screenId: 'test-measurement-consent',
        taskId: 'consent-review',
        outcome: 'completed',
      });
      toast.show({ title: copy.saved, variant: 'success' });
    } catch {
      toast.show({ title: copy.saveFailed, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const handleWithdraw = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await withdrawMeasurementConsent();
      setConsent(next);
      toast.show({ title: copy.deleted, variant: 'success' });
    } catch {
      toast.show({ title: copy.saveFailed, variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const styles = StyleSheet.create({
    content: { padding: spacing.md, paddingBottom: 96, gap: spacing.md },
    body: { ...typography.bodyM, color: colors.textSecondary },
    actions: { gap: spacing.sm },
  });

  return (
    <Screen scrollable>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={[typography.headlineSmall, { color: colors.textPrimary }]}>
          {copy.consentTitle}
        </Text>

        {decision.enabled ? (
          <Alert variant="warning">
            <AlertTitle>{copy.enabledBanner}</AlertTitle>
            <AlertDescription>{copy.consentBody}</AlertDescription>
          </Alert>
        ) : (
          <Alert variant="info">
            <AlertTitle>{copy.disabledTitle}</AlertTitle>
            <AlertDescription>{copy.disabledBody}</AlertDescription>
          </Alert>
        )}

        <Card variant="outlined" hideAccent>
          <CardContent style={{ gap: spacing.sm, padding: spacing.md }}>
            <CardTitle>{copy.consentTitle}</CardTitle>
            <CardDescription>{copy.consentBody}</CardDescription>
            {decision.enabled && !granted ? (
              <Button
                title={copy.grant}
                onPress={handleGrant}
                loading={busy}
                fullWidth
                accessibilityHint={copy.consentBody}
              />
            ) : null}
            {granted ? (
              <Button
                title={copy.withdraw}
                onPress={handleWithdraw}
                loading={busy}
                variant="destructive"
                fullWidth
              />
            ) : null}
          </CardContent>
        </Card>

        <View style={styles.actions}>
          {granted ? (
            <>
              <Button title={copy.openIssue} onPress={() => navigation.navigate('IssueReport')} variant="outline" fullWidth />
              <Button title={copy.openSummary} onPress={() => navigation.navigate('TestSessionSummary')} variant="outline" fullWidth />
            </>
          ) : null}
        </View>
        <Text style={styles.body}>{copy.retention}</Text>
      </View>
    </Screen>
  );
}
