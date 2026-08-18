import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert as NativeAlert, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { Alert, AlertDescription, AlertTitle } from '../components/ui/Alert';
import Button from '../components/ui/Button';
import { Card, CardContent, CardDescription, CardTitle } from '../components/ui/Card';
import Screen from '../components/ui/Screen';
import { useToast } from '../components/ui/Toast';
import { useLanguage } from '../context/LanguageProvider';
import { getModeratedTestCopy } from '../i18n/languageAccessibilityCopy';
import { buildContentFreeAggregateReport } from '../lib/measurement/aggregateReport';
import type { MeasurementEvent } from '../lib/measurement/eventSchema';
import type { IssueReport } from '../lib/measurement/issueSchema';
import {
  deleteAllLocalTestData,
  deleteIssueReports,
  deleteMeasurementEvents,
  getMeasurementSession,
  listIssueReports,
  listMeasurementEvents,
  setMeasurementSessionAssistance,
  withdrawMeasurementConsent,
  type MeasurementSession,
} from '../lib/measurement/localEventStore';
import { getMeasurementModeDecision } from '../lib/measurement/measurementConfig';
import { useTheme } from '../theme/SimpleThemeProvider';
import { spacing, typography } from '../theme/tokens';

export default function TestSessionSummary() {
  const { colors } = useTheme();
  const { languageCode } = useLanguage();
  const copy = getModeratedTestCopy(languageCode);
  const toast = useToast();
  const decision = useMemo(() => getMeasurementModeDecision(), []);
  const [events, setEvents] = useState<MeasurementEvent[]>([]);
  const [issues, setIssues] = useState<IssueReport[]>([]);
  const [session, setSession] = useState<MeasurementSession | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextEvents, nextIssues, nextSession] = await Promise.all([
        listMeasurementEvents(), listIssueReports(), getMeasurementSession(),
      ]);
      setEvents(nextEvents);
      setIssues(nextIssues);
      setSession(nextSession);
    } catch {
      toast.show({ title: copy.loadFailed, variant: 'error' });
    }
  }, [copy.loadFailed, toast]);

  useEffect(() => { void load(); }, [load]);
  const aggregate = useMemo(() => buildContentFreeAggregateReport(events, issues), [events, issues]);

  const confirmDelete = (operation: () => Promise<void>) => {
    NativeAlert.alert(copy.confirmDeleteTitle, copy.confirmDeleteBody, [
      { text: copy.cancel, style: 'cancel' },
      {
        text: copy.confirmDelete,
        style: 'destructive',
        onPress: () => {
          void operation().then(load).then(() => {
            toast.show({ title: copy.deleted, variant: 'success' });
          }).catch(() => toast.show({ title: copy.saveFailed, variant: 'error' }));
        },
      },
    ]);
  };

  const setAssistance = async (value: MeasurementSession['assistance']) => {
    try {
      setSession(await setMeasurementSessionAssistance(value));
      toast.show({ title: copy.saved, variant: 'success' });
    } catch {
      toast.show({ title: copy.saveFailed, variant: 'error' });
    }
  };

  const copyAggregate = async () => {
    try {
      await Clipboard.setStringAsync(JSON.stringify(aggregate, null, 2));
      toast.show({ title: copy.aggregateCopied, variant: 'success' });
    } catch {
      toast.show({ title: copy.saveFailed, variant: 'error' });
    }
  };

  const styles = StyleSheet.create({
    content: { padding: spacing.md, paddingBottom: 96, gap: spacing.md },
    row: { gap: spacing.xs },
    detail: { ...typography.bodyS, color: colors.textSecondary },
    actions: { gap: spacing.sm },
  });

  return (
    <Screen scrollable>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={[typography.headlineSmall, { color: colors.textPrimary }]}>{copy.summaryTitle}</Text>
        <Text style={[typography.bodyM, { color: colors.textSecondary }]}>{copy.summaryBody}</Text>
        {decision.enabled ? (
          <Alert variant="warning"><AlertTitle>{copy.enabledBanner}</AlertTitle><AlertDescription>{copy.consentBody}</AlertDescription></Alert>
        ) : null}

        {session ? (
          <Card variant="outlined" hideAccent>
            <CardContent style={{ gap: spacing.sm, padding: spacing.md }}>
              <CardTitle>{copy.assistanceTitle}</CardTitle>
              <CardDescription>{copy.assistanceBody}</CardDescription>
              <Button title={copy.assistanceNone} variant={session.assistance === 'none' ? 'primary' : 'outline'} onPress={() => setAssistance('none')} fullWidth />
              <Button title={copy.assistanceModerator} variant={session.assistance === 'moderator' ? 'primary' : 'outline'} onPress={() => setAssistance('moderator')} fullWidth />
              <Button title={copy.assistanceNotRecorded} variant={session.assistance === 'not_recorded' ? 'primary' : 'outline'} onPress={() => setAssistance('not_recorded')} fullWidth />
            </CardContent>
          </Card>
        ) : null}

        <Card variant="outlined" hideAccent>
          <CardContent style={{ gap: spacing.sm, padding: spacing.md }}>
            <CardTitle>{copy.eventsHeading} ({events.length})</CardTitle>
            {events.length === 0 ? <CardDescription>{copy.noEvents}</CardDescription> : events.map((event, index) => (
              <View key={`${event.name}-${event.recordedAtBucket}-${index}`} style={styles.row}>
                <Text style={[typography.labelLarge, { color: colors.textPrimary }]}>{event.name}</Text>
                <Text style={styles.detail}>{event.screenId} · {event.outcome} · {event.elapsedMsBucket} ms bucket</Text>
                <Text style={styles.detail}>{event.diagnostics ? copy.diagnosticsIncluded : copy.diagnosticsExcluded}</Text>
              </View>
            ))}
          </CardContent>
        </Card>

        <Card variant="outlined" hideAccent>
          <CardContent style={{ gap: spacing.sm, padding: spacing.md }}>
            <CardTitle>{copy.issuesHeading} ({issues.length})</CardTitle>
            {issues.length === 0 ? <CardDescription>{copy.noIssues}</CardDescription> : issues.map((issue, index) => (
              <View key={`${issue.category}-${issue.createdAtBucket}-${index}`} style={styles.row}>
                <Text style={[typography.labelLarge, { color: colors.textPrimary }]}>{issue.category}</Text>
                <Text style={styles.detail}>{issue.screenId} · {issue.severity} · {issue.actualBehavior}</Text>
                <Text style={styles.detail}>{issue.diagnostics ? copy.diagnosticsIncluded : copy.diagnosticsExcluded}</Text>
              </View>
            ))}
          </CardContent>
        </Card>

        <View style={styles.actions}>
          <Button title={copy.copyAggregate} onPress={copyAggregate} fullWidth />
          <Button title={copy.deleteEvents} onPress={() => confirmDelete(deleteMeasurementEvents)} variant="outline" fullWidth />
          <Button title={copy.deleteIssues} onPress={() => confirmDelete(deleteIssueReports)} variant="outline" fullWidth />
          <Button title={copy.withdraw} onPress={() => confirmDelete(async () => { await withdrawMeasurementConsent(); })} variant="destructive" fullWidth />
          <Button title={copy.deleteAll} onPress={() => confirmDelete(deleteAllLocalTestData)} variant="destructive" fullWidth />
        </View>
      </View>
    </Screen>
  );
}
