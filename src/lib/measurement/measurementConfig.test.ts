import { describe, expect, it } from 'vitest';

import rawControls from '../../../config/measurement/moderated-test-controls.v1.json';
import { evaluateMeasurementMode } from './measurementConfig';

function approvedControls() {
  return {
    ...structuredClone(rawControls),
    capability: { status: 'enabled', reason: null },
    approval: {
      ...rawControls.approval,
      status: 'approved',
      approvalId: 'synthetic-approval-for-test',
      approvedAt: '2026-07-30T00:00:00.000Z',
      expiresAt: '2026-08-02T00:00:00.000Z',
    },
    consent: {
      ...rawControls.consent,
      requiredVersion: 'moderated-test-consent.synthetic-v1',
    },
    retention: { ...rawControls.retention, hours: 24 },
  };
}

const runtime = {
  enabled: true,
  controlVersion: rawControls.controlVersion,
  environment: 'test',
  buildProfile: 'test',
};

describe('moderated measurement controls', () => {
  it('keeps the checked-in capability disabled until approval exists', () => {
    expect(evaluateMeasurementMode(runtime, rawControls).enabled).toBe(false);
    expect(evaluateMeasurementMode(runtime, rawControls)).toMatchObject({
      reason: 'measurement_capability_disabled',
    });
  });

  it('enables only a matching non-production test build during an approval window', () => {
    expect(evaluateMeasurementMode(
      runtime,
      approvedControls(),
      new Date('2026-07-31T00:00:00.000Z'),
    ).enabled).toBe(true);
  });

  it.each([
    [{ ...runtime, enabled: false }, 'measurement_build_flag_disabled'],
    [{ ...runtime, controlVersion: 'wrong' }, 'measurement_control_version_mismatch'],
    [{ ...runtime, environment: 'production' }, 'measurement_environment_not_allowed'],
    [{ ...runtime, buildProfile: 'production' }, 'measurement_build_profile_not_allowed'],
  ])('fails closed for runtime mismatch %#', (candidate, reason) => {
    expect(evaluateMeasurementMode(
      candidate,
      approvedControls(),
      new Date('2026-07-31T00:00:00.000Z'),
    )).toMatchObject({ enabled: false, reason });
  });

  it('rejects expired, future-dated, malformed, and incomplete approvals', () => {
    expect(evaluateMeasurementMode(
      runtime,
      approvedControls(),
      new Date('2026-08-03T00:00:00.000Z'),
    )).toMatchObject({ enabled: false, reason: 'measurement_approval_missing_or_expired' });

    const future = approvedControls();
    future.approval.approvedAt = '2026-08-01T12:00:00.000Z';
    expect(evaluateMeasurementMode(
      runtime,
      future,
      new Date('2026-07-31T00:00:00.000Z'),
    )).toMatchObject({ enabled: false, reason: 'measurement_approval_missing_or_expired' });

    const approved = approvedControls();
    const noConsent = {
      ...approved,
      consent: { ...approved.consent, requiredVersion: null },
    };
    expect(evaluateMeasurementMode(
      runtime,
      noConsent,
      new Date('2026-07-31T00:00:00.000Z'),
    )).toMatchObject({ enabled: false, reason: 'measurement_consent_or_retention_unapproved' });

    expect(evaluateMeasurementMode(runtime, { schemaVersion: 'bad' })).toMatchObject({
      enabled: false,
      reason: 'measurement_controls_invalid',
      controls: null,
    });
  });
});
