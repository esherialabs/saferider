import { describe, expect, it } from 'vitest';

import rawControls from '../../../../config/rsi/rsi-privacy-controls.v1.json';
import { getMobileRsiSignalDecision } from '../rsiSignalConfig';

describe('mobile RSI signal activation', () => {
  it('keeps the checked-in runtime disabled with no production area or consent version', () => {
    const decision = getMobileRsiSignalDecision(new Date('2026-07-30T00:00:00.000Z'));
    expect(decision).toMatchObject({ enabled: false, reason: 'pending_privacy_mentor_and_legal_approval' });
    expect(decision.config.enabled).toBe(false);
    expect(decision.config.allowedAreaIds).toEqual([]);
    expect(decision.config.consentVersion).toBeNull();
  });

  it('enables only a complete, unexpired, on-device coarse-grid approval', () => {
    const approved: any = structuredClone(rawControls);
    approved.activation.signalIngestion = { status: 'enabled', reason: null };
    approved.approval = {
      ...approved.approval,
      status: 'approved', approvalId: 'synthetic-approval', approvedByRole: 'synthetic-reviewer',
      approvedAt: '2026-07-29T00:00:00.000Z', expiresAt: '2026-08-30T00:00:00.000Z', minimumCount: 10,
    };
    approved.fixedBuckets.areaDefinitionVersion = 'synthetic-area-v1';
    approved.fixedBuckets.allowedAreaIds = ['cell-1774-4336'];
    approved.spatialTransform = {
      status: 'approved', executionBoundary: 'on_device', implementationVersion: 'synthetic-grid-v1',
      coarseCellSizeDegrees: 0.05, rawCoordinatesTransmitted: false,
    };
    approved.consent.requiredVersion = 'synthetic-consent-v1';

    const decision = getMobileRsiSignalDecision(new Date('2026-07-30T00:00:00.000Z'), approved);
    expect(decision).toMatchObject({
      enabled: true,
      config: {
        consentVersion: 'synthetic-consent-v1',
        allowedAreaIds: ['cell-1774-4336'],
        cellSizeDegrees: 0.05,
      },
    });
  });

  it('fails closed for expired approval, server-only transform, or malformed controls', () => {
    const expired: any = structuredClone(rawControls);
    expired.activation.signalIngestion = { status: 'enabled', reason: null };
    expired.approval = {
      ...expired.approval, status: 'approved', approvalId: 'synthetic',
      expiresAt: '2026-07-29T00:00:00.000Z',
    };
    expect(getMobileRsiSignalDecision(new Date('2026-07-30T00:00:00.000Z'), expired)).toMatchObject({
      enabled: false, reason: 'rsi_mobile_approval_missing_or_expired',
    });
    expect(getMobileRsiSignalDecision(new Date(), { activation: {} })).toMatchObject({
      enabled: false, reason: 'rsi_mobile_controls_invalid',
    });
  });
});
