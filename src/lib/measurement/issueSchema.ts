import { z } from 'zod';

import {
  COARSE_TIME_BUCKET_MS,
  MEASUREMENT_SCREEN_IDS,
  MEASUREMENT_TASK_IDS,
  floorToCoarseTimeBucket,
  measurementDiagnosticsSchema,
  type MeasurementDiagnostics,
} from './eventSchema';

export const ISSUE_CATEGORIES = [
  'navigation',
  'copy_clarity',
  'accessibility',
  'privacy_boundary',
  'offline_recovery',
  'performance',
  'unexpected_error',
] as const;

export const ISSUE_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const EXPECTED_BEHAVIORS = [
  'task_completes',
  'data_stays_local',
  'clear_blocker_is_shown',
  'selection_is_saved',
  'screen_changes',
] as const;
export const ACTUAL_BEHAVIORS = [
  'control_unresponsive',
  'wrong_screen',
  'unclear_copy',
  'selection_not_saved',
  'unexpected_blocker',
  'unexpected_error',
  'slow_or_stalled',
] as const;

const issueInputSchema = z.object({
  category: z.enum(ISSUE_CATEGORIES),
  screenId: z.enum(MEASUREMENT_SCREEN_IDS),
  taskId: z.enum(MEASUREMENT_TASK_IDS),
  severity: z.enum(ISSUE_SEVERITIES),
  expectedBehavior: z.enum(EXPECTED_BEHAVIORS),
  actualBehavior: z.enum(ACTUAL_BEHAVIORS),
  diagnostics: measurementDiagnosticsSchema.nullable().optional(),
  diagnosticsReviewed: z.literal(true).optional(),
}).strict();

export type IssueReportInput = z.input<typeof issueInputSchema>;
export type IssueReport = z.infer<typeof issueInputSchema> & {
  schemaVersion: 'measurement-issue.v1';
  issueId: string;
  createdAtBucket: string;
  diagnostics: MeasurementDiagnostics | null;
};

export function createIssueReport(params: {
  input: IssueReportInput;
  issueId: string;
  now?: Date;
}): IssueReport {
  const input = issueInputSchema.parse(params.input);
  if ((input.diagnostics !== undefined && input.diagnostics !== null) !== (input.diagnosticsReviewed === true)) {
    throw new Error('Optional diagnostics require an explicit user review confirmation.');
  }
  const timestamp = floorToCoarseTimeBucket((params.now ?? new Date()).getTime());
  return {
    ...input,
    schemaVersion: 'measurement-issue.v1',
    issueId: params.issueId,
    createdAtBucket: new Date(timestamp).toISOString(),
    diagnostics: input.diagnostics ?? null,
  };
}

export function parseStoredIssueReport(value: unknown): IssueReport {
  return issueInputSchema.extend({
    schemaVersion: z.literal('measurement-issue.v1'),
    issueId: z.string().uuid(),
    createdAtBucket: z.string().datetime(),
    diagnostics: measurementDiagnosticsSchema.nullable(),
  }).strict().parse(value) as IssueReport;
}

export const ISSUE_TIME_BUCKET_MS = COARSE_TIME_BUCKET_MS;
