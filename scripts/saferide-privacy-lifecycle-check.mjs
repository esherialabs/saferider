import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

export async function validatePrivacyLifecycle(root = repositoryRoot) {
  const controlsPath = resolve(root, 'config/privacy/privacy-controls.v1.json');
  const controls = JSON.parse(await readFile(controlsPath, 'utf8'));
  invariant(controls.schema === 'com.saferide.privacy-controls', 'privacy control schema mismatch');
  invariant(controls.schemaVersion === 1, 'privacy control schema version mismatch');
  invariant(typeof controls.controlVersion === 'string' && controls.controlVersion.length > 0, 'control version missing');

  const documentKeys = new Set();
  for (const document of controls.policyDocuments ?? []) {
    const key = `${document.documentType}/${document.version}/${document.locale}`;
    invariant(!documentKeys.has(key), `duplicate policy document ${key}`);
    documentKeys.add(key);
    const content = await readFile(resolve(root, document.path));
    invariant(sha256(content) === document.sha256, `policy hash mismatch for ${key}`);
    if (document.acceptanceEnabled) {
      invariant(document.reviewStatus === 'approved', `unapproved document accepts: ${key}`);
      invariant(Boolean(document.effectiveDate), `effective date missing for accepted document: ${key}`);
    }
  }
  invariant(documentKeys.size >= 2, 'privacy and terms documents are required');

  const policyIds = new Set();
  for (const policy of controls.retentionPolicies ?? []) {
    invariant(!policyIds.has(policy.policyId), `duplicate retention policy ${policy.policyId}`);
    policyIds.add(policy.policyId);
    if (policy.executionEnabled) {
      invariant(String(policy.approvalStatus).startsWith('approved_'), `unapproved retention policy executes: ${policy.policyId}`);
    }
  }
  invariant(policyIds.has('local-manual-v1'), 'manual local retention policy missing');
  invariant(policyIds.has('submitted-case-pending-legal-v1'), 'submitted-case retention policy missing');

  for (const capability of ['minor_processing', 'submitted_case_ingestion', 'remote_chat_ingestion', 'anonymous_signal_ingestion', 'dsar_server_processing', 'server_retention_execution', 'evidence_transform_processing']) {
    invariant(controls.capabilities?.[capability]?.status === 'disabled', `${capability} must fail closed in this candidate`);
  }
  invariant(controls.malwareScanPolicy?.status === 'disabled', 'malware scanning must stay disabled pending attributable approval');

  const [caseRoute, caseContracts, caseService, caseRepository, chatRoute, authRoute, auditService, migration, submissionMigration, anonymousSignal, privacyLifecycle, deletionWorkflow, consentLedger, consentService, privacyControls, apiDockerfile, draftRoute] = await Promise.all([
    readFile(resolve(root, 'apps/api/src/routes/cases.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/contracts/caseContracts.ts'), 'utf8'),
    readFile(resolve(root, 'src/services/caseService.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/repositories/caseRepository.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/routes/chat.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/routes/auth.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/services/auditService.ts'), 'utf8'),
    readFile(resolve(root, 'infra/postgres/migrations/004_privacy_lifecycle.sql'), 'utf8'),
    readFile(resolve(root, 'infra/postgres/migrations/006_case_submission_integrity.sql'), 'utf8'),
    readFile(resolve(root, 'src/utils/anonymousSignal.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/services/privacyLifecycle.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/services/deletionWorkflow.ts'), 'utf8'),
    readFile(resolve(root, 'src/utils/consentLedger.ts'), 'utf8'),
    readFile(resolve(root, 'src/services/privacyConsentService.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/config/privacyControls.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/Dockerfile'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/routes/drafts.ts'), 'utf8'),
  ]);
  invariant(!caseRoute.includes('summary: z.record'), 'generic case summary schema remains enabled');
  invariant(!caseRoute.includes('retention: z.record'), 'arbitrary attachment retention remains enabled');
  invariant(caseRoute.includes('getEvidenceDownloadDecision'), 'evidence download quarantine gate missing');
  invariant(caseContracts.includes('savePrivateLocalRecordSchema'), 'explicit save-private local contract missing');
  invariant(caseContracts.includes('anonymousSignalSchema'), 'strict anonymous-signal contract missing');
  invariant(caseContracts.includes('pathwayConsent'), 'pathway-consent submission contract missing');
  invariant(caseContracts.includes('idempotencyKey') && caseContracts.includes('recordId'), 'case consent identity or idempotency contract missing');
  invariant(caseService.includes('pathway-specific consent checkpoint'), 'mobile submission consent gate missing');
  invariant(caseService.includes('idempotencyKey: pathwayConsent.recordId'), 'mobile case retry identity is not stable');
  invariant(caseRepository.includes('submitCaseTransaction') && caseRepository.includes("await client.query('begin')") && caseRepository.includes("await client.query('commit')"), 'atomic case submission transaction missing');
  invariant(caseRepository.includes("values ($1, $2, $3, $4, 'granted', now())"), 'server-timed pathway consent missing');
  invariant(caseRepository.includes("values ('case.create', 'case', $1, 'success', $2)"), 'case audit is outside the submission transaction');
  invariant(submissionMigration.includes('cases_owner_submission_idempotency_unique'), 'case idempotency database index missing');
  invariant(submissionMigration.includes('cases_consent_owner_fk'), 'case-to-consent ownership constraint missing');
  invariant(caseRoute.includes("isPrivacyCapabilityEnabled('submitted_case_ingestion')"), 'submitted-case ingestion fail-closed gate missing');
  invariant(chatRoute.includes("isPrivacyCapabilityEnabled('remote_chat_ingestion')"), 'remote chat ingestion fail-closed gate missing');
  invariant(authRoute.includes("isPrivacyCapabilityEnabled('minor_processing')"), 'remote account minor-processing gate missing');
  invariant(!draftRoute.includes('z.record(z.unknown())'), 'generic remote draft persistence remains enabled');
  invariant(draftRoute.includes('Remote draft persistence is disabled'), 'remote draft fail-closed gate missing');
  invariant(!auditService.includes('actor_id'), 'audit service still writes actor identifiers');
  invariant(!auditService.includes('resource_id'), 'audit service still writes resource identifiers');
  invariant(!auditService.includes('metadata'), 'audit service still writes arbitrary metadata');
  invariant(anonymousSignal.includes('ANONYMOUS_SIGNAL_FORBIDDEN_KEYS'), 'anonymous-signal forbidden-field gate missing');
  invariant(consentLedger.includes('recordPolicyAcceptance') && consentLedger.includes('recordPathwayConsent'), 'separate consent/policy history missing');
  invariant(
    consentLedger.includes("remoteWithdrawalStatus?: 'pending' | 'confirmed'") &&
    consentLedger.includes('confirmRemoteConsentWithdrawal'),
    'retryable aggregate-consent withdrawal state missing',
  );
  invariant(
    consentService.includes('/privacy/consents/${encodeURIComponent(consentId)}/withdraw') &&
    consentService.includes('RemoteConsentWithdrawalPendingError'),
    'authenticated remote aggregate-consent withdrawal missing',
  );
  for (const document of controls.policyDocuments) {
    invariant(
      consentLedger.includes(document.sha256) && migration.includes(document.sha256),
      `mobile or migration policy identity is stale for ${document.documentType}/${document.locale}`,
    );
  }
  invariant(privacyControls.includes("../../config/privacy/privacy-controls.v1.json"), 'local API privacy-control path fallback missing');
  invariant(apiDockerfile.includes('COPY config/privacy ./config/privacy'), 'API image does not package privacy controls');
  invariant(migration.includes('audit_events_minimized_fields_check'), 'audit minimization migration constraint missing');
  invariant(migration.includes('legacy-minimized.1'), 'historical lifecycle minimization migration missing');
  invariant(migration.includes('attachments_retention_policy_fk'), 'attachment retention policy foreign key missing');
  invariant(migration.includes('enforce_approved_policy_acceptance'), 'database policy-acceptance approval gate missing');
  invariant(migration.includes('attachments_release_attestation_check'), 'database evidence-release attestation gate missing');
  invariant(migration.includes('enforce_dsar_status_transition') && migration.includes('dsar_due_target'), 'database DSAR transition or 30-day gate missing');
  for (const target of ['object_storage', 'derived_linkable_records', 'temporary_files', 'abandoned_uploads']) {
    invariant(migration.includes(target) && privacyLifecycle.includes(target) && deletionWorkflow.includes('DELETION_TARGET_CLASSES'), `deletion coverage missing ${target}`);
  }
  for (const status of ['requested', 'verified', 'executing', 'completed', 'partially_completed', 'failed', 'legal_hold']) {
    invariant(migration.includes(status) && privacyLifecycle.includes(status), `deletion state missing ${status}`);
  }

  return {
    controlVersion: controls.controlVersion,
    documentCount: documentKeys.size,
    retentionPolicyCount: policyIds.size,
    checks: 60,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await validatePrivacyLifecycle();
    process.stdout.write(`privacy lifecycle validation passed (${result.checks} checks, ${result.documentCount} policy documents, ${result.retentionPolicyCount} retention policies)\n`);
  } catch (error) {
    process.stderr.write(`privacy lifecycle validation failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  }
}
