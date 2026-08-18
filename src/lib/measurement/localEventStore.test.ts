import AsyncStorage from '@react-native-async-storage/async-storage';
import { beforeEach, describe, expect, it } from 'vitest';

import rawControls from '../../../config/measurement/moderated-test-controls.v1.json';
import { __resetEncryptedAsyncStorageForTests, isEncryptedAsyncStorageEnvelope } from '../encryptedAsyncStorage';
import {
  __resetMeasurementStoreForTests,
  deleteAllLocalTestData,
  grantMeasurementConsent,
  listIssueReports,
  listMeasurementEvents,
  recordMeasurementEvent,
  saveIssueReport,
  setMeasurementSessionAssistance,
  withdrawMeasurementConsent,
} from './localEventStore';
import { evaluateMeasurementMode } from './measurementConfig';
import {
  MEASUREMENT_CONSENT_KEY,
  MEASUREMENT_EVENTS_KEY,
  MEASUREMENT_ISSUES_KEY,
  MEASUREMENT_SESSION_KEY,
} from '../../utils/storageKeys';

function approvedDecision(now = new Date('2026-07-31T00:00:00.000Z')) {
  const controls = {
    ...structuredClone(rawControls),
    capability: { status: 'enabled', reason: null },
    approval: {
      ...rawControls.approval,
      status: 'approved',
      approvalId: 'synthetic-test-approval',
      approvedAt: '2026-07-30T00:00:00.000Z',
      expiresAt: '2026-08-03T00:00:00.000Z',
    },
    consent: { ...rawControls.consent, requiredVersion: 'consent.synthetic-v1' },
    retention: { ...rawControls.retention, hours: 24, maxEvents: 2 },
  };
  const decision = evaluateMeasurementMode({
    enabled: true,
    controlVersion: rawControls.controlVersion,
    environment: 'test',
    buildProfile: 'test',
  }, controls, now);
  if (!decision.enabled) throw new Error(decision.reason);
  return decision;
}

const startInput = {
  name: 'report_start' as const,
  screenId: 'home' as const,
  taskId: 'report-flow' as const,
  outcome: 'started' as const,
};

describe('encrypted local moderated-test store', () => {
  beforeEach(() => {
    __resetEncryptedAsyncStorageForTests();
    __resetMeasurementStoreForTests();
  });

  it('does not record under the checked-in disabled controls', async () => {
    await expect(recordMeasurementEvent(startInput)).resolves.toMatchObject({ recorded: false });
    await expect(saveIssueReport({
      category: 'privacy_boundary',
      screenId: 'privacy-data',
      taskId: 'privacy-export',
      severity: 'high',
      expectedBehavior: 'data_stays_local',
      actualBehavior: 'unexpected_error',
    })).rejects.toThrow('measurement is unavailable');
    await expect(AsyncStorage.getItem(MEASUREMENT_EVENTS_KEY)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(MEASUREMENT_ISSUES_KEY)).resolves.toBeNull();
  });

  it('requires separate current consent and encrypts consent, session, and content-free events', async () => {
    const now = new Date('2026-07-31T00:00:00.000Z');
    const decision = approvedDecision(now);
    await expect(recordMeasurementEvent(startInput, { decision, now })).resolves.toEqual({
      recorded: false,
      reason: 'measurement_consent_missing_or_stale',
    });

    await grantMeasurementConsent({ decision, now });
    await expect(recordMeasurementEvent(startInput, {
      decision,
      now: new Date('2026-07-31T00:00:31.000Z'),
    })).resolves.toMatchObject({ recorded: true });

    for (const key of [MEASUREMENT_CONSENT_KEY, MEASUREMENT_SESSION_KEY, MEASUREMENT_EVENTS_KEY]) {
      const raw = await AsyncStorage.getItem(key);
      expect(isEncryptedAsyncStorageEnvelope(raw)).toBe(true);
      expect(raw).not.toContain('report_start');
    }
    await expect(listMeasurementEvents(new Date('2026-07-31T00:01:00.000Z')))
      .resolves.toHaveLength(1);
  });

  it('withdraws consent, deletes events, and blocks stale consent', async () => {
    const decision = approvedDecision();
    await grantMeasurementConsent({ decision, now: new Date('2026-07-31T00:00:00.000Z') });
    await recordMeasurementEvent(startInput, { decision, now: new Date('2026-07-31T00:01:00.000Z') });
    await withdrawMeasurementConsent({ now: new Date('2026-07-31T00:02:00.000Z') });

    await expect(AsyncStorage.getItem(MEASUREMENT_SESSION_KEY)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(MEASUREMENT_EVENTS_KEY)).resolves.toBeNull();
    await expect(recordMeasurementEvent(startInput, { decision })).resolves.toEqual({
      recorded: false,
      reason: 'measurement_consent_missing_or_stale',
    });
  });

  it('purges expired events and caps the event list', async () => {
    const decision = approvedDecision();
    const start = new Date('2026-07-31T00:00:00.000Z');
    await grantMeasurementConsent({ decision, now: start });
    for (const minute of [1, 2, 3]) {
      await recordMeasurementEvent(startInput, {
        decision,
        now: new Date(start.getTime() + minute * 60_000),
      });
    }
    await expect(listMeasurementEvents(new Date('2026-07-31T00:04:00.000Z')))
      .resolves.toHaveLength(2);
    await expect(listMeasurementEvents(new Date('2026-08-01T00:04:00.000Z')))
      .resolves.toEqual([]);
    await expect(AsyncStorage.getItem(MEASUREMENT_EVENTS_KEY)).resolves.toBeNull();
  });

  it('stores only categorical issue reports, encrypted, and deletes all local test data', async () => {
    const now = new Date('2026-07-31T00:00:00.000Z');
    const decision = approvedDecision(now);
    await expect(saveIssueReport({
      category: 'privacy_boundary',
      screenId: 'privacy-data',
      taskId: 'privacy-export',
      severity: 'high',
      expectedBehavior: 'data_stays_local',
      actualBehavior: 'unexpected_error',
    }, { decision, now })).rejects.toThrow('No current consented moderated-test session');
    await grantMeasurementConsent({ decision, now });
    await saveIssueReport({
      category: 'privacy_boundary',
      screenId: 'privacy-data',
      taskId: 'privacy-export',
      severity: 'high',
      expectedBehavior: 'data_stays_local',
      actualBehavior: 'unexpected_error',
    }, { decision, now });
    const raw = await AsyncStorage.getItem(MEASUREMENT_ISSUES_KEY);
    expect(isEncryptedAsyncStorageEnvelope(raw)).toBe(true);
    expect(raw).not.toContain('privacy_boundary');
    await expect(listIssueReports(new Date('2026-07-31T00:01:00.000Z'))).resolves.toHaveLength(1);

    await deleteAllLocalTestData();
    for (const key of [MEASUREMENT_CONSENT_KEY, MEASUREMENT_SESSION_KEY, MEASUREMENT_EVENTS_KEY, MEASUREMENT_ISSUES_KEY]) {
      await expect(AsyncStorage.getItem(key)).resolves.toBeNull();
    }
  });

  it('blocks session mutation after consent withdrawal or control disablement', async () => {
    const decision = approvedDecision();
    await grantMeasurementConsent({ decision, now: new Date('2026-07-31T00:00:00.000Z') });
    await expect(setMeasurementSessionAssistance('moderator', { decision })).resolves.toMatchObject({
      assistance: 'moderator',
    });
    await withdrawMeasurementConsent({ now: new Date('2026-07-31T00:02:00.000Z') });
    await expect(setMeasurementSessionAssistance('none', { decision })).rejects.toThrow(
      'No current consented moderated-test session',
    );
    await expect(setMeasurementSessionAssistance('none')).rejects.toThrow('measurement is unavailable');
  });

  it('fails closed when encrypted local data is corrupt', async () => {
    await AsyncStorage.setItem(MEASUREMENT_EVENTS_KEY, '{not-json');
    await expect(listMeasurementEvents()).rejects.toThrow();
  });
});
