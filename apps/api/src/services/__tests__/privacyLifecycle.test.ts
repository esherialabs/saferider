import { describe, expect, it } from 'vitest';

import {
  assertDeletionTransition,
  assertPolicyAcceptable,
  buildConsentWithdrawal,
  buildDeletionReceipt,
  calculateDsarDueAt,
  DELETION_TARGET_CLASSES,
  planRetentionRun,
} from '../privacyLifecycle.js';

describe('privacy lifecycle state machines', () => {
  it('sets a 30-day rights-request target and rejects invalid deletion transitions', () => {
    expect(calculateDsarDueAt(new Date('2026-07-30T12:00:00Z')).toISOString()).toBe('2026-08-29T12:00:00.000Z');
    expect(() => assertDeletionTransition('requested', 'verified')).not.toThrow();
    expect(() => assertDeletionTransition('requested', 'completed')).toThrow(/Invalid deletion transition/);
  });

  it('builds a content-free, hashed receipt covering every linkable target class', () => {
    const result = buildDeletionReceipt({
      requestId: 'synthetic-request',
      completedAt: '2026-07-30T12:00:00.000Z',
      policyVersion: 'synthetic-policy',
      targetResults: DELETION_TARGET_CLASSES.map(targetClass => ({ targetClass, status: 'deleted' })),
    });
    expect(result.status).toBe('completed');
    expect(result.evidenceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.receipt.targets).toHaveLength(DELETION_TARGET_CLASSES.length);
    expect(JSON.stringify(result.receipt)).not.toContain('narrative');
  });

  it('fails retention closed until an explicit policy is approved', () => {
    const candidates = [{
      resourceClass: 'case_rows' as const,
      resourceId: 'synthetic',
      createdAt: '2026-01-01T00:00:00.000Z',
      policyId: 'server-30',
    }];
    expect(planRetentionRun({
      now: new Date('2026-07-30T00:00:00Z'),
      policy: { policyId: 'server-30', durationDays: 30, executionEnabled: false, approvalStatus: 'pending_legal' },
      candidates,
    })).toEqual({ executable: false, blockedReason: 'retention_policy_not_approved', targets: [] });
    expect(planRetentionRun({
      now: new Date('2026-07-30T00:00:00Z'),
      policy: { policyId: 'server-30', durationDays: 30, executionEnabled: true, approvalStatus: 'approved_legal' },
      candidates,
    }).targets).toHaveLength(1);
  });

  it('records withdrawal as future-only and warns about prior sharing', () => {
    const withdrawal = buildConsentWithdrawal({ consentId: 'synthetic', purpose: 'research', withdrawnAt: '2026-07-30T00:00:00Z' });
    expect(withdrawal).toMatchObject({ status: 'withdrawn', effect: 'future_processing_only' });
    expect(withdrawal.externalSharingEffect).toContain('cannot be recalled');
  });

  it('covers retry-safe transitions and every deletion receipt terminal state', () => {
    expect(() => assertDeletionTransition('requested', 'requested')).not.toThrow();
    expect(buildDeletionReceipt({
      requestId: 'legal-hold',
      completedAt: '2026-07-30T12:00:00.000Z',
      policyVersion: 'synthetic-policy',
      targetResults: [{ targetClass: 'case_rows', status: 'legal_hold' }],
    }).status).toBe('legal_hold');
    expect(buildDeletionReceipt({
      requestId: 'failed',
      completedAt: '2026-07-30T12:00:00.000Z',
      policyVersion: 'synthetic-policy',
      targetResults: DELETION_TARGET_CLASSES.map(targetClass => ({ targetClass, status: 'failed' })),
    }).status).toBe('failed');
    expect(buildDeletionReceipt({
      requestId: 'partial',
      completedAt: '2026-07-30T12:00:00.000Z',
      policyVersion: 'synthetic-policy',
      targetResults: [{ targetClass: 'case_rows', status: 'deleted' }],
    }).status).toBe('partially_completed');
  });

  it('requires every policy approval field and handles manual retention', () => {
    expect(() => assertPolicyAcceptable({
      reviewStatus: 'approved',
      acceptanceEnabled: true,
      effectiveDate: '2026-07-30',
    })).not.toThrow();
    for (const document of [
      { reviewStatus: 'pending', acceptanceEnabled: true, effectiveDate: '2026-07-30' },
      { reviewStatus: 'approved', acceptanceEnabled: false, effectiveDate: '2026-07-30' },
      { reviewStatus: 'approved', acceptanceEnabled: true, effectiveDate: null },
    ]) {
      expect(() => assertPolicyAcceptable(document)).toThrow(/not approved/);
    }
    expect(planRetentionRun({
      now: new Date('2026-07-30T00:00:00Z'),
      policy: { policyId: 'manual', durationDays: null, executionEnabled: true, approvalStatus: 'approved_legal' },
      candidates: [],
    })).toEqual({ executable: true, targets: [] });
  });

  it('excludes recent and policy-mismatched retention candidates', () => {
    const result = planRetentionRun({
      now: new Date('2026-07-30T00:00:00Z'),
      policy: { policyId: 'server-30', durationDays: 30, executionEnabled: true, approvalStatus: 'approved_legal' },
      candidates: [
        { resourceClass: 'case_rows', resourceId: 'wrong-policy', createdAt: '2026-01-01T00:00:00.000Z', policyId: 'other' },
        { resourceClass: 'case_rows', resourceId: 'recent', createdAt: '2026-07-29T00:00:00.000Z', policyId: 'server-30' },
      ],
    });
    expect(result).toEqual({ executable: true, targets: [] });
  });
});
