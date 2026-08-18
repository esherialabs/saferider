import * as Crypto from 'expo-crypto';
import { z } from 'zod';

import { encryptedAsyncStorage } from '../encryptedAsyncStorage';
import {
  MEASUREMENT_CONSENT_KEY,
  MEASUREMENT_EVENTS_KEY,
  MEASUREMENT_ISSUES_KEY,
  MEASUREMENT_SESSION_KEY,
} from '../../utils/storageKeys';
import {
  MEASUREMENT_ASSISTANCE,
  createMeasurementEvent,
  floorToCoarseTimeBucket,
  parseStoredMeasurementEvent,
  type MeasurementEvent,
  type MeasurementEventInput,
} from './eventSchema';
import {
  createIssueReport,
  parseStoredIssueReport,
  type IssueReport,
  type IssueReportInput,
} from './issueSchema';
import {
  getMeasurementModeDecision,
  type MeasurementModeDecision,
} from './measurementConfig';

export const LOCAL_ISSUE_RETENTION_HOURS = 24;
export const LOCAL_ISSUE_MAX_REPORTS = 100;

const consentSchema = z.object({
  schemaVersion: z.literal('measurement-consent.v1'),
  recordId: z.string().uuid(),
  status: z.enum(['granted', 'withdrawn']),
  controlVersion: z.string().min(1),
  consentVersion: z.string().min(1),
  grantedAtBucket: z.string().datetime(),
  withdrawnAtBucket: z.string().datetime().optional(),
}).strict();

const sessionSchema = z.object({
  schemaVersion: z.literal('measurement-session.v1'),
  sessionId: z.string().uuid(),
  controlVersion: z.string().min(1),
  consentVersion: z.string().min(1),
  startedAtBucketMs: z.number().int().nonnegative(),
  assistance: z.enum(MEASUREMENT_ASSISTANCE),
}).strict();

export type MeasurementConsentRecord = z.infer<typeof consentSchema>;
export type MeasurementSession = z.infer<typeof sessionSchema>;
export type MeasurementRecordResult =
  | { recorded: true; event: MeasurementEvent }
  | { recorded: false; reason: string };

let writeQueue: Promise<void> = Promise.resolve();

function enqueueWrite<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeQueue.catch(() => undefined).then(operation);
  writeQueue = result.then(() => undefined, () => undefined);
  return result;
}

function coarseIso(now: Date): string {
  return new Date(floorToCoarseTimeBucket(now.getTime())).toISOString();
}

async function readJson(key: string): Promise<unknown> {
  const raw = await encryptedAsyncStorage.getItem(key);
  if (!raw) return null;
  return JSON.parse(raw) as unknown;
}

async function readEventArray(): Promise<MeasurementEvent[]> {
  const value = await readJson(MEASUREMENT_EVENTS_KEY);
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error('Local measurement event storage is corrupt.');
  return value.map(parseStoredMeasurementEvent);
}

async function readIssueArray(): Promise<IssueReport[]> {
  const value = await readJson(MEASUREMENT_ISSUES_KEY);
  if (value === null) return [];
  if (!Array.isArray(value)) throw new Error('Local product issue storage is corrupt.');
  return value.map(parseStoredIssueReport);
}

export async function getMeasurementConsent(): Promise<MeasurementConsentRecord | null> {
  const value = await readJson(MEASUREMENT_CONSENT_KEY);
  return value === null ? null : consentSchema.parse(value);
}

export async function getMeasurementSession(): Promise<MeasurementSession | null> {
  const value = await readJson(MEASUREMENT_SESSION_KEY);
  return value === null ? null : sessionSchema.parse(value);
}

export function hasCurrentMeasurementAuthorization(
  decision: MeasurementModeDecision,
  consent: MeasurementConsentRecord | null,
  session: MeasurementSession | null,
): boolean {
  if (!decision.enabled || !consent || !session) return false;
  const requiredConsentVersion = decision.controls.consent.requiredVersion;
  return consent.status === 'granted'
    && Boolean(requiredConsentVersion)
    && consent.controlVersion === decision.controls.controlVersion
    && consent.consentVersion === requiredConsentVersion
    && session.controlVersion === consent.controlVersion
    && session.consentVersion === consent.consentVersion;
}

export async function setMeasurementSessionAssistance(
  assistance: typeof MEASUREMENT_ASSISTANCE[number],
  options: { decision?: MeasurementModeDecision; now?: Date } = {},
): Promise<MeasurementSession> {
  const decision = options.decision ?? getMeasurementModeDecision(options.now);
  if (!decision.enabled) {
    throw new Error(`Moderated-test measurement is unavailable: ${decision.reason}.`);
  }
  return enqueueWrite(async () => {
    const [consent, session] = await Promise.all([
      getMeasurementConsent(),
      getMeasurementSession(),
    ]);
    if (!hasCurrentMeasurementAuthorization(decision, consent, session) || !session) {
      throw new Error('No current consented moderated-test session exists.');
    }
    const next: MeasurementSession = { ...session, assistance };
    await encryptedAsyncStorage.setItem(MEASUREMENT_SESSION_KEY, JSON.stringify(next));
    return next;
  });
}

export async function grantMeasurementConsent(params: {
  decision?: MeasurementModeDecision;
  now?: Date;
} = {}): Promise<MeasurementConsentRecord> {
  const decision = params.decision ?? getMeasurementModeDecision(params.now);
  if (!decision.enabled) {
    throw new Error(`Moderated-test measurement is unavailable: ${decision.reason}.`);
  }
  const consentVersion = decision.controls.consent.requiredVersion;
  if (!consentVersion) throw new Error('Moderated-test consent version is unavailable.');
  const now = params.now ?? new Date();
  const grantedAtBucket = coarseIso(now);
  const consent: MeasurementConsentRecord = {
    schemaVersion: 'measurement-consent.v1',
    recordId: Crypto.randomUUID(),
    status: 'granted',
    controlVersion: decision.controls.controlVersion,
    consentVersion,
    grantedAtBucket,
  };
  const session: MeasurementSession = {
    schemaVersion: 'measurement-session.v1',
    sessionId: Crypto.randomUUID(),
    controlVersion: decision.controls.controlVersion,
    consentVersion,
    startedAtBucketMs: floorToCoarseTimeBucket(now.getTime()),
    assistance: 'not_recorded',
  };

  return enqueueWrite(async () => {
    try {
      await encryptedAsyncStorage.setItem(MEASUREMENT_CONSENT_KEY, JSON.stringify(consent));
      await encryptedAsyncStorage.setItem(MEASUREMENT_SESSION_KEY, JSON.stringify(session));
      await encryptedAsyncStorage.setItem(MEASUREMENT_EVENTS_KEY, '[]');
      return consent;
    } catch (error) {
      await encryptedAsyncStorage.multiRemove([
        MEASUREMENT_CONSENT_KEY,
        MEASUREMENT_SESSION_KEY,
        MEASUREMENT_EVENTS_KEY,
      ]).catch(() => undefined);
      throw error;
    }
  });
}

export async function withdrawMeasurementConsent(params: {
  now?: Date;
  deleteEvents?: boolean;
} = {}): Promise<MeasurementConsentRecord | null> {
  return enqueueWrite(async () => {
    const current = await getMeasurementConsent();
    if (!current) return null;
    const withdrawn: MeasurementConsentRecord = {
      ...current,
      status: 'withdrawn',
      withdrawnAtBucket: coarseIso(params.now ?? new Date()),
    };
    await encryptedAsyncStorage.setItem(MEASUREMENT_CONSENT_KEY, JSON.stringify(withdrawn));
    await encryptedAsyncStorage.removeItem(MEASUREMENT_SESSION_KEY);
    if (params.deleteEvents !== false) {
      await encryptedAsyncStorage.removeItem(MEASUREMENT_EVENTS_KEY);
    }
    return withdrawn;
  });
}

export async function recordMeasurementEvent(
  input: MeasurementEventInput,
  options: { decision?: MeasurementModeDecision; now?: Date } = {},
): Promise<MeasurementRecordResult> {
  const decision = options.decision ?? getMeasurementModeDecision(options.now);
  if (!decision.enabled) return { recorded: false, reason: decision.reason };

  return enqueueWrite(async () => {
    const [consent, session] = await Promise.all([
      getMeasurementConsent(),
      getMeasurementSession(),
    ]);
    if (!hasCurrentMeasurementAuthorization(decision, consent, session) || !session) {
      return { recorded: false, reason: 'measurement_consent_missing_or_stale' };
    }

    const now = options.now ?? new Date();
    const retentionMs = (decision.controls.retention.hours ?? 0) * 60 * 60 * 1000;
    if (retentionMs <= 0) return { recorded: false, reason: 'measurement_retention_unapproved' };
    const cutoff = floorToCoarseTimeBucket(now.getTime() - retentionMs);
    const existing = (await readEventArray()).filter(event => (
      new Date(event.recordedAtBucket).getTime() >= cutoff
    ));
    const event = createMeasurementEvent({
      input,
      eventId: Crypto.randomUUID(),
      sessionId: session.sessionId,
      sessionStartedAtBucketMs: session.startedAtBucketMs,
      controlVersion: session.controlVersion,
      consentVersion: session.consentVersion,
      retentionHours: decision.controls.retention.hours ?? 0,
      now,
    });
    const next = [...existing, event].slice(-decision.controls.retention.maxEvents);
    await encryptedAsyncStorage.setItem(MEASUREMENT_EVENTS_KEY, JSON.stringify(next));
    return { recorded: true, event };
  });
}

export function captureMeasurementEvent(input: MeasurementEventInput): void {
  void recordMeasurementEvent(input).catch(() => undefined);
}

export function captureReportCompletion(): void {
  void getMeasurementSession()
    .then(session => recordMeasurementEvent({
      name: 'report_complete',
      screenId: 'consent-gate',
      taskId: 'report-flow',
      outcome: 'completed',
      assistance: session?.assistance ?? 'not_recorded',
    }))
    .catch(() => undefined);
}

export async function listMeasurementEvents(now = new Date()): Promise<MeasurementEvent[]> {
  return enqueueWrite(async () => {
    const events = await readEventArray();
    const active = events.filter(event => new Date(event.expiresAtBucket).getTime() > now.getTime());
    if (active.length !== events.length) {
      if (active.length === 0) await encryptedAsyncStorage.removeItem(MEASUREMENT_EVENTS_KEY);
      else await encryptedAsyncStorage.setItem(MEASUREMENT_EVENTS_KEY, JSON.stringify(active));
    }
    return active;
  });
}

export async function saveIssueReport(
  input: IssueReportInput,
  options: { decision?: MeasurementModeDecision; now?: Date } = {},
): Promise<IssueReport> {
  const decision = options.decision ?? getMeasurementModeDecision(options.now);
  if (!decision.enabled) {
    throw new Error(`Moderated-test measurement is unavailable: ${decision.reason}.`);
  }
  return enqueueWrite(async () => {
    const [consent, session] = await Promise.all([
      getMeasurementConsent(),
      getMeasurementSession(),
    ]);
    if (!hasCurrentMeasurementAuthorization(decision, consent, session)) {
      throw new Error('No current consented moderated-test session exists.');
    }
    const maxIssueReports = Math.min(
      decision.controls.retention.maxIssueReports,
      LOCAL_ISSUE_MAX_REPORTS,
    );
    const report = createIssueReport({ input, issueId: Crypto.randomUUID(), now: options.now });
    const cutoff = floorToCoarseTimeBucket(
      (options.now ?? new Date()).getTime() - LOCAL_ISSUE_RETENTION_HOURS * 60 * 60 * 1000,
    );
    const existing = (await readIssueArray()).filter(issue => (
      new Date(issue.createdAtBucket).getTime() >= cutoff
    ));
    await encryptedAsyncStorage.setItem(
      MEASUREMENT_ISSUES_KEY,
      JSON.stringify([...existing, report].slice(-maxIssueReports)),
    );
    return report;
  });
}

export async function listIssueReports(now = new Date()): Promise<IssueReport[]> {
  return enqueueWrite(async () => {
    const cutoff = floorToCoarseTimeBucket(
      now.getTime() - LOCAL_ISSUE_RETENTION_HOURS * 60 * 60 * 1000,
    );
    const issues = await readIssueArray();
    const active = issues.filter(issue => new Date(issue.createdAtBucket).getTime() >= cutoff);
    if (active.length !== issues.length) {
      if (active.length === 0) await encryptedAsyncStorage.removeItem(MEASUREMENT_ISSUES_KEY);
      else await encryptedAsyncStorage.setItem(MEASUREMENT_ISSUES_KEY, JSON.stringify(active));
    }
    return active;
  });
}

export async function deleteMeasurementEvents(): Promise<void> {
  await enqueueWrite(() => encryptedAsyncStorage.removeItem(MEASUREMENT_EVENTS_KEY));
}

export async function deleteIssueReports(): Promise<void> {
  await enqueueWrite(() => encryptedAsyncStorage.removeItem(MEASUREMENT_ISSUES_KEY));
}

export async function deleteAllLocalTestData(): Promise<void> {
  await enqueueWrite(() => encryptedAsyncStorage.multiRemove([
    MEASUREMENT_CONSENT_KEY,
    MEASUREMENT_SESSION_KEY,
    MEASUREMENT_EVENTS_KEY,
    MEASUREMENT_ISSUES_KEY,
  ]));
}

export function __resetMeasurementStoreForTests(): void {
  writeQueue = Promise.resolve();
}
