import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

export async function validateRsiPrivacy(root = repositoryRoot) {
  const controls = JSON.parse(await readFile(resolve(root, 'config/rsi/rsi-privacy-controls.v1.json'), 'utf8'));
  const privacyControls = JSON.parse(await readFile(resolve(root, 'config/privacy/privacy-controls.v1.json'), 'utf8'));
  const syntheticProof = JSON.parse(await readFile(resolve(root, 'docs/qa/fixtures/rsi-synthetic-proof/public-release.json'), 'utf8'));
  const syntheticProofSvg = await readFile(resolve(root, 'docs/qa/fixtures/rsi-synthetic-proof/public-release.svg'), 'utf8');
  invariant(controls.schema === 'com.saferide.rsi-privacy-controls', 'RSI control schema mismatch');
  invariant(controls.schemaVersion === 1, 'RSI control schema version mismatch');
  invariant(Object.values(controls.activation).every(capability => capability.status === 'disabled'), 'RSI runtime capabilities must default disabled');
  invariant(controls.approval.status === 'pending' && controls.approval.minimumCount === null, 'unapproved production threshold must remain null');
  invariant(controls.fixedBuckets.allowedAreaIds.length === 0, 'production area IDs require privacy approval');
  invariant(
    controls.spatialTransform.status === 'pending_approval' &&
    controls.spatialTransform.coarseCellSizeDegrees === null &&
    controls.spatialTransform.executionBoundary === 'on_device' &&
    controls.spatialTransform.rawCoordinatesTransmitted === false,
    'production spatial transform must remain fail-closed and on-device',
  );
  invariant(controls.consent.requiredVersion === null, 'production aggregate consent version requires approval');
  invariant(controls.rawSignalRetention.status === 'pending_legal' && controls.rawSignalRetention.durationDays === null, 'raw-signal retention must fail closed');
  invariant(controls.syntheticTestProfile.testOnly === true && controls.syntheticTestProfile.minimumCount === 10, 'synthetic threshold must be test-only and labeled');
  invariant(controls.differentialPrivacy.status === 'not_approved', 'differential privacy cannot be represented as approved');
  for (const field of ['epsilon', 'delta', 'sensitivity', 'clipping', 'composition', 'releaseCadenceHours']) {
    invariant(controls.differentialPrivacy[field] === null, `unapproved DP field must be null: ${field}`);
  }
  invariant(JSON.stringify(controls.queryPolicy.allowedQueryKeys) === JSON.stringify(['releaseId', 'viewId']), 'RSI query allowlist is not fixed');
  invariant(
    syntheticProof.dataClass === 'synthetic-test-only' &&
    syntheticProof.configuration.policyStatus === 'provisional-test-only-not-approved' &&
    syntheticProof.release.cells.every(cell => cell.state === 'suppressed' && cell.display === 'No data'),
    'synthetic RSI proof is unlabeled or contains an unsuppressed cell',
  );
  const serializedProofRelease = JSON.stringify(syntheticProof.release);
  for (const forbidden of ['rawCount', 'previousRawCount', 'suppressionReasons', 'reasons', 'memoizedNoise', 'value']) {
    invariant(!serializedProofRelease.includes(forbidden), `synthetic public proof exposes ${forbidden}`);
  }
  const { revisionSha256, ...releaseWithoutHash } = syntheticProof.release;
  invariant(
    createHash('sha256').update(JSON.stringify(releaseWithoutHash)).digest('hex') === revisionSha256,
    'synthetic RSI proof revision does not match its public release',
  );
  invariant(
    syntheticProofSvg.includes('SYNTHETIC TEST OUTPUT') && syntheticProofSvg.includes('No data') &&
    !syntheticProofSvg.includes('rawCount') && !syntheticProofSvg.includes('suppressionReasons'),
    'synthetic RSI rendering is mislabeled or exposes internal fields',
  );
  const aggregateConsent = privacyControls.consentPurposes?.anonymous_aggregate;
  if (controls.activation.signalIngestion.status === 'enabled') {
    invariant(
      aggregateConsent?.status === 'enabled' && aggregateConsent.version === controls.consent.requiredVersion,
      'RSI ingestion and privacy aggregate-consent manifests are not version-aligned',
    );
  } else {
    invariant(aggregateConsent?.status === 'disabled', 'aggregate consent cannot activate while RSI ingestion is disabled');
  }

  const [migration, integrityMigration, route, signalContract, signalService, aggregation, releaseService, retentionService, retentionJob, mobileConfig, mobileService, mobileSignal, consentSummary, suppression, differencing, repository, server, dockerfile, signalSchema, releaseSchema] = await Promise.all([
    readFile(resolve(root, 'infra/postgres/migrations/005_rsi_privacy.sql'), 'utf8'),
    readFile(resolve(root, 'infra/postgres/migrations/006_case_submission_integrity.sql'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/routes/rsi.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/contracts/rsiContracts.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/services/rsiSignalService.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/services/rsiAggregationService.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/services/rsiReleaseService.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/services/rsiRetentionService.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/jobs/rsiRetentionJob.ts'), 'utf8'),
    readFile(resolve(root, 'src/config/rsi/rsiSignalConfig.ts'), 'utf8'),
    readFile(resolve(root, 'src/services/rsiSignalService.ts'), 'utf8'),
    readFile(resolve(root, 'src/utils/anonymousSignal.ts'), 'utf8'),
    readFile(resolve(root, 'src/utils/consentSummary.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/services/privacySuppressionService.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/services/differencingProtectionService.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/repositories/rsiRepository.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/src/server.ts'), 'utf8'),
    readFile(resolve(root, 'apps/api/Dockerfile'), 'utf8'),
    readFile(resolve(root, 'schemas/rsi-signal.schema.json'), 'utf8'),
    readFile(resolve(root, 'schemas/rsi-public-release.schema.json'), 'utf8'),
  ]);
  const signalTable = migration.slice(
    migration.indexOf('create table if not exists saferide.anonymous_route_signals'),
    migration.indexOf('create table if not exists saferide.aggregate_release_windows'),
  );
  for (const forbidden of ['owner_id', 'user_id', 'narrative', 'evidence', 'latitude', 'longitude', 'phone', 'email']) {
    invariant(!signalTable.includes(forbidden), `raw RSI table contains forbidden field ${forbidden}`);
  }
  const publicView = migration.slice(
    migration.indexOf('create or replace view saferide.rsi_public_release_cells'),
    migration.indexOf('create or replace function saferide.protect_published_rsi_cells'),
  );
  invariant(
    !publicView.includes('raw_count') && !publicView.includes('previous_raw_count') &&
    !publicView.includes('memoized_noise') && !publicView.includes('suppression_reasons'),
    'public RSI view exposes internal counts, noise, or suppression rationale',
  );
  for (const table of [
    'corridor_definitions', 'anonymous_route_signals', 'aggregate_release_windows',
    'rsi_aggregate_cells', 'suppression_decisions', 'privacy_budget_ledger', 'operator_access_audit',
  ]) {
    invariant(migration.includes(`saferide.${table}`), `RSI migration table missing: ${table}`);
  }
  invariant(
    migration.includes('protect_published_rsi_cells') && migration.includes('protect_published_rsi_release') &&
    migration.includes('protect_published_rsi_internal_evidence') && migration.includes('protect_approved_corridor_definition') &&
    migration.includes('enforce_adjacent_rsi_release_window') && migration.includes('idx_rsi_single_initial_window'),
    'RSI immutable release, privacy-budget, suppression, or area-definition triggers missing',
  );
  invariant(route.includes("auth.role !== controls.queryPolicy.operatorRole"), 'least-privilege RSI operator role gate missing');
  invariant(route.includes('enforceRsiRateLimit') && route.includes('recordRsiOperatorAccess'), 'RSI rate limit or operator audit missing');
  invariant(!route.includes('/api/rsi/signals/raw'), 'raw-signal operator route must not exist');
  invariant(route.includes("requireCapability('signalIngestion')") && route.includes("capability: 'export'"), 'RSI fail-closed capability gates missing');
  invariant(signalService.includes('RSI_SIGNAL_FORBIDDEN_FIELDS') && signalContract.includes('.strict()'), 'strict minimized signal contract missing');
  invariant(mobileSignal.includes('buildAnonymousSignals') && mobileSignal.includes('allowedAreaIds'), 'mobile minimized-signal allowlist gate missing');
  invariant(
    mobileConfig.includes('rawCoordinatesTransmitted') &&
    mobileService.includes("path: '/rsi/signals/batch'") &&
    mobileService.includes('consent: {') &&
    mobileService.includes('ingestionId: params.aggregateConsent.ingestionId') &&
    !mobileService.includes("path: '/privacy/consents'"),
    'mobile evidence-derived activation, consent, or minimized batch submitter missing',
  );
  invariant(
    route.includes('submitAnonymousRsiSignalsWithConsent') &&
    repository.includes("insert into saferide.consent_records") &&
    repository.includes("insert into saferide.anonymous_route_signals") &&
    repository.includes("await client.query('commit')"),
    'RSI consent and minimized-signal persistence must share one transaction',
  );
  invariant(
    integrityMigration.includes('add column if not exists ingestion_id uuid') &&
    integrityMigration.includes('anonymous_route_signals_ingestion_dimension_unique'),
    'RSI retry-safe ingestion migration is missing',
  );
  invariant(
    consentSummary.includes('Exact coordinates are transformed on this device') &&
    consentSummary.includes('cannot be singled out or recalled'),
    'RSI consent copy does not disclose spatial transformation or aggregate withdrawal limits',
  );
  invariant(
    aggregation.includes('gridCellCount') &&
    aggregation.includes('rawCount: 0') &&
    aggregation.includes('Continuous RSI release requires every adjacent fixed-grid count') &&
    releaseService.includes('areaIds: controls.fixedBuckets.allowedAreaIds') &&
    releaseService.includes('maxCells: controls.queryPolicy.maxRows'),
    'RSI complete fixed-grid or adjacent-window fail-closed aggregation is missing',
  );
  invariant(
    retentionService.includes("getRsiCapabilityDecision('retentionExecution'") &&
    retentionService.includes("isPrivacyCapabilityEnabled('server_retention_execution')") &&
    repository.includes('deleteExpiredAnonymousRsiSignals') && retentionJob.includes('failed closed'),
    'RSI expired-signal deletion is not dual-gated or executable',
  );
  for (const protection of [
    'below_minimum_count', 'adjacent_window_differencing', 'complementary_area_suppression',
    'complementary_category_suppression', 'complementary_time_suppression', 'corridor_triangulation_suppression',
  ]) {
    invariant(suppression.includes(protection), `RSI suppression protection missing: ${protection}`);
  }
  invariant(suppression.includes("display: 'No data'") && !suppression.includes("display: '0'"), 'low-count display must be No data, never zero');
  invariant(suppression.includes('memoizedNoise') && differencing.includes('immutable'), 'memoized noise or immutable revision protection missing');
  invariant(repository.includes('saferide.rsi_public_release_cells') && !repository.includes('select *'), 'operator repository must use minimized public view');
  invariant(
    repository.includes('privacy_budget_ledger') && repository.includes('memoized_noise is null') &&
    repository.includes('previous_raw_count is null') && repository.includes('revokePublishedRsiRelease'),
    'RSI DP publication integrity or release revocation gate missing',
  );
  invariant(server.includes('registerRsiRoutes'), 'RSI routes are not registered');
  invariant(dockerfile.includes('COPY config/rsi ./config/rsi'), 'API image does not package RSI controls');
  invariant(JSON.parse(signalSchema).additionalProperties === false, 'RSI signal JSON schema must reject extras');
  invariant(JSON.parse(releaseSchema).additionalProperties === false, 'RSI release JSON schema must reject extras');

  return {
    controlVersion: controls.controlVersion,
    syntheticMinimumCount: controls.syntheticTestProfile.minimumCount,
    checks: 73,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await validateRsiPrivacy();
    process.stdout.write(`RSI privacy validation passed (${result.checks} checks; synthetic k=${result.syntheticMinimumCount}; runtime disabled)\n`);
  } catch (error) {
    process.stderr.write(`RSI privacy validation failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exitCode = 1;
  }
}
