import { floorToCoarseTimeBucket, type MeasurementEvent } from './eventSchema';
import type { IssueReport } from './issueSchema';

type CountMap = Record<string, number>;

export type ContentFreeAggregateReport = {
  schemaVersion: 'measurement-aggregate.v1';
  generatedAtBucket: string;
  contentFree: true;
  eventCount: number;
  issueCount: number;
  reportStarts: number;
  reportCompletions: number;
  unassistedReportCompletions: number;
  unassistedCompletionRate: number | null;
  reportDropOffs: number;
  completionRate: number | null;
  medianTimeToReportMsBucket: number | null;
  retries: number;
  eventsByName: CountMap;
  stepCompletionsByScreen: CountMap;
  errorsByCode: CountMap;
  issuesByCategory: CountMap;
  issuesBySeverity: CountMap;
};

function increment(counts: CountMap, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

export function buildContentFreeAggregateReport(
  events: MeasurementEvent[],
  issues: IssueReport[],
  now = new Date(),
): ContentFreeAggregateReport {
  const eventsByName: CountMap = {};
  const stepCompletionsByScreen: CountMap = {};
  const errorsByCode: CountMap = {};
  const issuesByCategory: CountMap = {};
  const issuesBySeverity: CountMap = {};
  const reportDurations: number[] = [];
  const startsBySession = new Map<string, number>();

  for (const event of events) {
    increment(eventsByName, event.name);
    if (event.name === 'step_complete') increment(stepCompletionsByScreen, event.screenId);
    if (event.errorCode) increment(errorsByCode, event.errorCode);
    if (event.name === 'report_start') startsBySession.set(event.sessionId, event.elapsedMsBucket);
    if (event.name === 'report_complete') {
      const start = startsBySession.get(event.sessionId);
      if (start !== undefined && event.elapsedMsBucket >= start) {
        reportDurations.push(event.elapsedMsBucket - start);
      }
    }
  }
  for (const issue of issues) {
    increment(issuesByCategory, issue.category);
    increment(issuesBySeverity, issue.severity);
  }

  const reportStarts = eventsByName.report_start ?? 0;
  const reportCompletions = eventsByName.report_complete ?? 0;
  const unassistedReportCompletions = events.filter(event => (
    event.name === 'report_complete' && event.assistance === 'none'
  )).length;
  return {
    schemaVersion: 'measurement-aggregate.v1',
    generatedAtBucket: new Date(floorToCoarseTimeBucket(now.getTime())).toISOString(),
    contentFree: true,
    eventCount: events.length,
    issueCount: issues.length,
    reportStarts,
    reportCompletions,
    unassistedReportCompletions,
    unassistedCompletionRate: reportStarts > 0 ? unassistedReportCompletions / reportStarts : null,
    reportDropOffs: Math.max(0, reportStarts - reportCompletions),
    completionRate: reportStarts > 0 ? reportCompletions / reportStarts : null,
    medianTimeToReportMsBucket: median(reportDurations),
    retries: events.filter(event => event.outcome === 'retry').length,
    eventsByName,
    stepCompletionsByScreen,
    errorsByCode,
    issuesByCategory,
    issuesBySeverity,
  };
}
