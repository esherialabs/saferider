import { afterEach, describe, expect, it } from 'vitest';

import {
  getRsiCapabilityDecision,
  loadRsiControls,
  parseRsiControls,
  resetRsiControlsForTests,
} from '../rsiControls.js';

const originalPath = process.env.SAFERIDE_RSI_CONTROLS_PATH;

afterEach(() => {
  if (originalPath === undefined) delete process.env.SAFERIDE_RSI_CONTROLS_PATH;
  else process.env.SAFERIDE_RSI_CONTROLS_PATH = originalPath;
  resetRsiControlsForTests();
});

describe('RSI privacy controls', () => {
  it('loads a disabled production policy and a labeled test-only synthetic profile', () => {
    const controls = loadRsiControls();
    expect(controls.controlVersion).toBe('rsi-privacy-controls.2026-07-30.1');
    expect(Object.values(controls.activation).every(capability => capability.status === 'disabled')).toBe(true);
    expect(controls.approval).toMatchObject({ status: 'pending', minimumCount: null });
    expect(controls.syntheticTestProfile).toMatchObject({ testOnly: true, minimumCount: 10 });
    expect(getRsiCapabilityDecision('operatorRead')).toMatchObject({ enabled: false });
  });

  it('fails closed when the configured manifest is missing', () => {
    process.env.SAFERIDE_RSI_CONTROLS_PATH = '/nonexistent/saferide/rsi-controls.json';
    resetRsiControlsForTests();
    expect(() => loadRsiControls()).toThrow('unavailable');
    expect(getRsiCapabilityDecision('signalIngestion')).toEqual({ enabled: false, reason: 'rsi_controls_unavailable' });
  });

  it('rejects activation without complete approval and dashboard noise evidence', () => {
    const pending = structuredClone(loadRsiControls());
    pending.activation.operatorRead = { status: 'enabled', reason: null };
    expect(() => parseRsiControls(pending)).toThrow(/complete attributable/);

    const approved = structuredClone(loadRsiControls());
    approved.activation.dashboard = { status: 'enabled', reason: null };
    approved.approval = {
      status: 'approved', approvalId: 'synthetic-approval', approvedByRole: 'synthetic-reviewer',
      approvedAt: '2026-07-29T00:00:00.000Z', expiresAt: '2026-08-30T00:00:00.000Z', minimumCount: 10,
    };
    approved.fixedBuckets.areaDefinitionVersion = 'synthetic-area-v1';
    approved.fixedBuckets.allowedAreaIds = ['cell-100-100'];
    approved.spatialTransform = {
      status: 'approved', executionBoundary: 'on_device', implementationVersion: 'synthetic-grid-v1',
      coarseCellSizeDegrees: 0.05, rawCoordinatesTransmitted: false,
    };
    approved.consent.requiredVersion = 'synthetic-consent-v1';
    approved.rawSignalRetention = { status: 'approved', durationDays: 7 };
    expect(() => parseRsiControls(approved)).toThrow(/differential-privacy/);
  });

  it('rejects inconsistent retention, bucket, and approval evidence', () => {
    const invalid = structuredClone(loadRsiControls());
    invalid.rawSignalRetention = { status: 'pending_legal', durationDays: 7 };
    expect(() => parseRsiControls(invalid)).toThrow(/retention duration/);

    invalid.rawSignalRetention = { status: 'pending_legal', durationDays: null };
    invalid.fixedBuckets.releaseCadenceHours = 5;
    invalid.fixedBuckets.timeBucketMinutes = 120;
    expect(() => parseRsiControls(invalid)).toThrow(/divide the fixed release cadence/);

    invalid.fixedBuckets.releaseCadenceHours = 24;
    invalid.fixedBuckets.timeBucketMinutes = 60;
    invalid.approval.approvalId = 'unattributed-proposal';
    expect(() => parseRsiControls(invalid)).toThrow(/Pending RSI approval/);
  });

  it('allows legally approved expiry deletion without activating ingestion or requiring a current RSI release approval', () => {
    const retentionOnly = structuredClone(loadRsiControls());
    retentionOnly.activation.retentionExecution = { status: 'enabled', reason: null };
    retentionOnly.rawSignalRetention = { status: 'approved', durationDays: 7 };
    expect(parseRsiControls(retentionOnly).activation.retentionExecution.status).toBe('enabled');
    expect(parseRsiControls(retentionOnly).activation.signalIngestion.status).toBe('disabled');
  });

  it('rejects release activation when the complete fixed grid exceeds the public row bound', () => {
    const controls = structuredClone(loadRsiControls());
    controls.activation.releaseGeneration = { status: 'enabled', reason: null };
    controls.approval = {
      status: 'approved', approvalId: 'synthetic-approval', approvedByRole: 'synthetic-reviewer',
      approvedAt: '2026-07-29T00:00:00.000Z', expiresAt: '2026-08-30T00:00:00.000Z', minimumCount: 10,
    };
    controls.fixedBuckets.areaDefinitionVersion = 'synthetic-area-v1';
    controls.fixedBuckets.allowedAreaIds = ['cell-100-100', 'cell-100-101', 'cell-100-102'];
    controls.spatialTransform = {
      status: 'approved', executionBoundary: 'on_device', implementationVersion: 'synthetic-grid-v1',
      coarseCellSizeDegrees: 0.05, rawCoordinatesTransmitted: false,
    };
    controls.consent.requiredVersion = 'synthetic-consent-v1';
    controls.rawSignalRetention = { status: 'approved', durationDays: 7 };
    controls.queryPolicy.maxRows = 10;
    expect(() => parseRsiControls(controls)).toThrow(/fixed release grid/);
  });
});
