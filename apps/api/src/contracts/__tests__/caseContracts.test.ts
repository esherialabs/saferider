import { describe, expect, it } from 'vitest';

import {
  anonymousSignalSchema,
  buildLifecyclePayload,
  createCaseSchema,
  savePrivateLocalRecordSchema,
} from '../caseContracts.js';

describe('case API contracts', () => {
  const consentRecordId = '11111111-1111-4111-8111-111111111111';

  it('keeps save-private explicitly local and anonymous signals free of direct identifiers', () => {
    expect(savePrivateLocalRecordSchema.parse({ schemaVersion: '1.0', workflowType: 'save-private', storage: 'local-only' })).toBeTruthy();
    expect(createCaseSchema.safeParse({
      idempotencyKey: consentRecordId,
      pathwayConsent: { recordId: consentRecordId, purpose: 'pathway_submission', version: 'pathway-consent.v1' },
      workflow: { schemaVersion: '1.0', workflowType: 'save-private', storage: 'local-only' },
    }).success).toBe(false);
    expect(anonymousSignalSchema.safeParse({
      schemaVersion: '1.0', configVersion: 'synthetic-test', policyVersion: 'synthetic-test',
      consentVersion: 'synthetic-consent-v1', area: { type: 'coarse_cell', id: 'cell-10-20' },
      timeBucket: '2026-07-30T10:00:00.000Z', category: 'harassment',
    }).success).toBe(true);
    expect(anonymousSignalSchema.safeParse({
      schemaVersion: '1.0', configVersion: 'synthetic-test', policyVersion: 'synthetic-test',
      consentVersion: 'synthetic-consent-v1', area: { type: 'coarse_cell', id: 'cell-10-20' },
      timeBucket: '2026-07-30T10:00:00.000Z', category: 'harassment', latitude: -1.2,
    }).success).toBe(false);
  });

  it('accepts a minimized referral and emits a content-free lifecycle event', () => {
    const parsed = createCaseSchema.parse({
      idempotencyKey: consentRecordId,
      draftId: 'synthetic-draft',
      pathwayConsent: { recordId: consentRecordId, purpose: 'pathway_submission', version: 'pathway-consent.v1' },
      workflow: {
        schemaVersion: '1.0',
        workflowType: 'referral',
        providerId: 'provider-1',
        channel: 'call',
        supportBrief: {
          included: true,
          selectedFields: ['incident_categories', 'location_type'],
          incidentCategories: ['harassment'],
          locationType: 'public_transport',
        },
      },
    });
    expect(buildLifecyclePayload(parsed.workflow)).toEqual({
      schemaVersion: '1.0',
      workflowType: 'referral',
      status: 'submitted',
    });
  });

  it('rejects generic summaries, extra fields, and mismatched referral selections', () => {
    expect(createCaseSchema.safeParse({ pathway: 'referral', summary: { narrative: 'synthetic' } }).success).toBe(false);
    expect(createCaseSchema.safeParse({
      workflow: {
        schemaVersion: '1.0',
        workflowType: 'referral',
        providerId: 'provider-1',
        channel: 'sms',
        supportBrief: { included: false, selectedFields: [], narrative: 'synthetic' },
      },
    }).success).toBe(false);
    expect(createCaseSchema.safeParse({
      workflow: {
        schemaVersion: '1.0',
        workflowType: 'referral',
        providerId: 'provider-1',
        channel: 'sms',
        supportBrief: { included: true, selectedFields: ['location_type'] },
      },
    }).success).toBe(false);
  });

  it('accepts the submitted-case envelope only with a schema-valid escalation', () => {
    const result = createCaseSchema.safeParse({
      idempotencyKey: consentRecordId,
      pathwayConsent: { recordId: consentRecordId, purpose: 'pathway_submission', version: 'pathway-consent.v1' },
      workflow: {
        schemaVersion: '1.0',
        workflowType: 'submitted-case',
        pathway: 'escalation',
        submission: {
          schemaVersion: '1.0',
          workflowType: 'escalation',
          packet: {
            version: '1.0',
            generatedAt: '2026-07-30T00:00:00.000Z',
            pathway: 'escalate',
            redactionLevel: 'heavy',
            contact: { preference: 'none', label: 'No contact identity included' },
            content: {
              timeRange: 'Not provided', location: 'Exact location redacted',
              incidentDescription: '[redacted]', statement: '[redacted]', tags: [], patterns: [], transportIdentifiers: [],
            },
            evidenceManifest: [],
            redaction: { appliedLabels: [], textFields: [], evidenceMetadata: 'redacted', mediaProcessing: [] },
          },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('binds submission idempotency to the exact consent record', () => {
    const result = createCaseSchema.safeParse({
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      pathwayConsent: { recordId: consentRecordId, purpose: 'pathway_submission', version: 'pathway-consent.v1' },
      workflow: {
        schemaVersion: '1.0',
        workflowType: 'referral',
        providerId: 'provider-1',
        channel: 'call',
        supportBrief: { included: false, selectedFields: [] },
      },
    });
    expect(result.success).toBe(false);
  });
});
