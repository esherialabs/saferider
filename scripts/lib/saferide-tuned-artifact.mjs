import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import Ajv2020 from 'ajv/dist/2020.js';

export const TUNED_ARTIFACT_PATHS = Object.freeze({
  manifest: 'config/ai/manifests/saferide-v058-original-419806.artifact-produced.json',
  controls: 'config/ai/tuned-artifact-controls.v2.json',
  deviceEvidence: 'docs/qa/saferide-tuned-artifact-device-evidence.pending.json',
});

export const TUNED_ARTIFACT_SCHEMA_PATHS = Object.freeze({
  manifest: 'schemas/tuned-mobile-artifact-manifest.schema.json',
  controls: 'schemas/tuned-artifact-controls.schema.json',
  deviceEvidence: 'schemas/tuned-artifact-device-evidence.schema.json',
});

export const TUNED_ARTIFACT_LIFECYCLE = Object.freeze([
  'training-complete',
  'adapter-evaluated',
  'export-blocked',
  'artifact-produced',
  'artifact-android-verified',
  'checkpoint-candidate',
  'release-candidate',
  'release-ready',
  'revoked',
]);

const DEVICE_CLASSES = Object.freeze(['android-2-3gb', 'android-4gb', 'android-6-8gb']);
const DEVICE_SCENARIOS = Object.freeze([
  'load',
  'generate',
  'cancel',
  'unload',
  'offline',
  'restart',
  'low-storage',
  'interrupted-download',
  'checksum-failure',
  'revocation',
  'rollback',
]);
const FORBIDDEN_PUBLIC_KEYS = /(?:prompt|completion|narrative|exactLocation|filePath|modelPath|participant|serialNumber|credential|token)$/i;

function readJson(fullPath) {
  return JSON.parse(fs.readFileSync(fullPath, 'utf8'));
}

export function sha256File(fullPath) {
  const hash = createHash('sha256');
  const file = fs.openSync(fullPath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(file, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(file);
  }
  return hash.digest('hex');
}

function compileValidators(rootDir) {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    strictTypes: false,
    validateFormats: false,
  });
  return Object.fromEntries(Object.entries(TUNED_ARTIFACT_SCHEMA_PATHS).map(([key, relativePath]) => (
    [key, ajv.compile(readJson(path.join(rootDir, relativePath)))]
  )));
}

function schemaErrors(label, validator, document) {
  if (validator(document)) return [];
  return (validator.errors ?? []).map(error => (
    `${label}${error.instancePath || '/'}: ${error.message ?? error.keyword}`
  ));
}

function findForbiddenPublicKey(value, prefix = '$') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenPublicKey(value[index], `${prefix}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.test(key)) return `${prefix}.${key}`;
    const found = findForbiddenPublicKey(child, `${prefix}.${key}`);
    if (found) return found;
  }
  return null;
}

function addIf(condition, collection, message) {
  if (condition) collection.push(message);
}

export function sourceBindsExactBundledManifestHash({
  modelRegistry,
  selection,
  manifestSha256,
}) {
  if (!/^[0-9a-f]{64}$/.test(manifestSha256)) return false;
  const registryBinding = new RegExp(
    `export\\s+const\\s+SAFERIDE_V058_TUNED_MANIFEST_SHA256\\s*=\\s*['\"]${manifestSha256}['\"]\\s*;`,
  );
  const selectionBinding = /export\s+const\s+TUNED_ARTIFACT_BUNDLED_MANIFEST_SHA256\s*=\s*SAFERIDE_V058_TUNED_MANIFEST_SHA256\s*;/;
  return registryBinding.test(modelRegistry) && selectionBinding.test(selection);
}

function validateRuntimeBindings(rootDir, manifest, manifestSha256) {
  const errors = [];
  const readSource = relativePath => fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  const selection = readSource('src/lib/localAssistant/tunedArtifactRuntimeSelection.ts');
  const modelRegistry = readSource('src/lib/localAssistant/modelRegistry.ts');
  const runtimeStore = readSource('src/config/runtime/runtimeConfigStore.ts');
  const assistantService = readSource('src/services/localAssistantService.ts');
  const app = readSource('App.tsx');
  const apiDockerfile = readSource('apps/api/Dockerfile');
  const nativeBridge = readSource('android/app/src/main/java/com/esheria/saferide/app/localai/SafeRideLiteRtLmModule.kt');

  addIf(
    !sourceBindsExactBundledManifestHash({ modelRegistry, selection, manifestSha256 }),
    errors,
    'mobile tuned selection is not bound to the exact bundled manifest file hash',
  );
  addIf(!selection.includes('resolveTunedArtifactRuntimeCandidate'), errors, 'mobile tuned selection does not invoke the fail-closed registry resolver');
  addIf(!runtimeStore.includes('remote-control-expired'), errors, 'mobile runtime config does not independently enforce tuned-control expiry');
  addIf(!assistantService.includes('handleLocalAssistantRuntimeConfigUpdate'), errors, 'local assistant does not handle live tuned-control updates');
  addIf(!app.includes('subscribeToRuntimeConfig') || !app.includes('startRuntimeConfigRefreshLoop'), errors, 'app startup does not subscribe to and refresh runtime controls');
  addIf(!apiDockerfile.includes('COPY config/ai'), errors, 'API runtime image does not package tuned-artifact controls');

  if (manifest.status === 'release-ready') {
    const normalizedNativeBridge = nativeBridge.replaceAll('_', '');
    for (const [label, value] of [
      ['model ID', manifest.modelId],
      ['manifest ID', manifest.manifestId],
      ['file name', manifest.artifact.fileName],
      ['artifact SHA-256', manifest.artifact.sha256],
      ['artifact byte size', manifest.artifact.sizeBytes],
    ]) {
      addIf(
        value === null || !normalizedNativeBridge.includes(String(value)),
        errors,
        `release-ready tuned artifact ${label} is absent from the native approved binding`,
      );
    }
  }
  return errors;
}

function validateStateHistory(manifest, lifecycle) {
  const errors = [];
  const currentIndex = lifecycle.indexOf(manifest.status);
  const history = manifest.stateHistory ?? [];
  const expected = lifecycle.slice(0, currentIndex + 1);
  const actual = history.map(entry => entry.state);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`manifest stateHistory must be the unskipped lifecycle prefix through ${manifest.status}`);
  }
  for (let index = 1; index < history.length; index += 1) {
    if (Date.parse(history[index].enteredAt) < Date.parse(history[index - 1].enteredAt)) {
      errors.push(`manifest stateHistory timestamp for ${history[index].state} precedes the prior state`);
    }
  }
  return errors;
}

function validateDeviceSemantics(deviceEvidence) {
  const errors = [];
  const classes = deviceEvidence.deviceMatrix.map(entry => entry.deviceClass);
  addIf(new Set(classes).size !== classes.length, errors, 'device evidence contains a duplicate device class');
  addIf(JSON.stringify([...classes].sort()) !== JSON.stringify([...DEVICE_CLASSES].sort()), errors, 'device evidence must cover exactly the 2-3 GB, 4 GB, and 6-8 GB Android classes');

  for (const device of deviceEvidence.deviceMatrix) {
    const scenarios = device.scenarios.map(entry => entry.scenario);
    addIf(new Set(scenarios).size !== scenarios.length, errors, `${device.deviceClass} contains a duplicate scenario`);
    addIf(JSON.stringify([...scenarios].sort()) !== JSON.stringify([...DEVICE_SCENARIOS].sort()), errors, `${device.deviceClass} must cover every required reliability scenario exactly once`);
  }

  const forbiddenKey = findForbiddenPublicKey(deviceEvidence);
  addIf(Boolean(forbiddenKey), errors, `device evidence contains forbidden public field ${forbiddenKey}`);

  if (deviceEvidence.status === 'blocked') {
    addIf(deviceEvidence.artifact.manifestId !== null || deviceEvidence.artifact.sha256 !== null || deviceEvidence.artifact.sizeBytes !== null, errors, 'blocked device evidence cannot invent tuned artifact identity');
    addIf(deviceEvidence.reviews.length !== 0, errors, 'blocked device evidence cannot contain approval reviews');
    for (const device of deviceEvidence.deviceMatrix) {
      addIf(device.supportDecision !== 'unverified', errors, `blocked evidence requires ${device.deviceClass} to remain unverified`);
      addIf(device.scenarios.some(scenario => scenario.status !== 'not-run'), errors, `blocked evidence cannot claim ${device.deviceClass} scenario results`);
    }
  }

  if (deviceEvidence.status === 'approved') {
    addIf(deviceEvidence.privacy.prohibitedLogContentDetected !== false, errors, 'approved device evidence requires a clean prohibited-content log inspection');
    addIf(deviceEvidence.reviews.length !== 2, errors, 'approved device evidence requires mobile QA and privacy/security reviews');
    addIf(new Set(deviceEvidence.reviews.map(review => review.reviewerRole)).size !== 2, errors, 'approved device evidence requires distinct reviewer roles');
    addIf(!deviceEvidence.rollback.revocationRehearsed || !deviceEvidence.rollback.artifactRemoved || !deviceEvidence.rollback.readyStateCleared, errors, 'approved device evidence requires a complete revocation and rollback rehearsal');
    for (const device of deviceEvidence.deviceMatrix) {
      addIf(device.supportDecision === 'unverified', errors, `approved evidence cannot leave ${device.deviceClass} unverified`);
      addIf(device.scenarios.some(scenario => scenario.status === 'not-run'), errors, `approved evidence cannot leave ${device.deviceClass} scenarios unrun`);
    }
  }
  return errors;
}

export function validateTunedArtifactDocuments({ manifest, controls, deviceEvidence, controlsSha256, asOfDate = '2026-07-30' }) {
  const errors = [];
  const blockers = [];

  addIf(JSON.stringify(controls.lifecycleOrder) !== JSON.stringify(TUNED_ARTIFACT_LIFECYCLE), errors, 'control lifecycle order differs from the repository-enforced lifecycle');
  errors.push(...validateStateHistory(manifest, controls.lifecycleOrder));
  errors.push(...validateDeviceSemantics(deviceEvidence));

  addIf(manifest.controlPolicy.controlId !== controls.controlId, errors, 'manifest controlPolicy.controlId does not match the selected controls');
  addIf(manifest.controlPolicy.sha256 !== controlsSha256, errors, 'manifest controlPolicy.sha256 does not match the exact controls file');
  addIf(manifest.rollbackTargetManifestId !== controls.rollback.targetManifestId, errors, 'manifest rollback target does not match the shared controls');

  if (manifest.status === 'export-blocked') {
    addIf(manifest.artifact.sha256 !== null || manifest.artifact.sizeBytes !== null || manifest.artifact.immutableLocation !== null, errors, 'export-blocked manifest cannot contain produced artifact identity');
    addIf(manifest.androidProof.tunedArtifactPhysicalDeviceProof, errors, 'export-blocked manifest cannot claim tuned physical-device proof');
  }

  if (TUNED_ARTIFACT_LIFECYCLE.indexOf(manifest.status) >= TUNED_ARTIFACT_LIFECYCLE.indexOf('artifact-produced')) {
    addIf(!manifest.artifact.sha256 || !manifest.artifact.sizeBytes || !manifest.artifact.immutableLocation, errors, `${manifest.status} requires exact immutable artifact identity`);
  }

  if (TUNED_ARTIFACT_LIFECYCLE.indexOf(manifest.status) >= TUNED_ARTIFACT_LIFECYCLE.indexOf('artifact-android-verified') && manifest.status !== 'revoked') {
    addIf(deviceEvidence.status !== 'approved', errors, `${manifest.status} requires approved exact-artifact device evidence`);
    addIf(deviceEvidence.artifact.manifestId !== manifest.manifestId, errors, 'device evidence manifest ID does not match the tuned manifest');
    addIf(deviceEvidence.artifact.sha256 !== manifest.artifact.sha256, errors, 'device evidence artifact hash does not match the tuned manifest');
  }

  if (manifest.status === 'revoked') {
    addIf(!controls.activation.revokedManifestIds.includes(manifest.manifestId) && !controls.activation.revokedArtifactSha256.includes(manifest.artifact.sha256), errors, 'revoked manifest must appear in a control revocation list');
  }

  addIf(!controls.activation.enabled, blockers, `activation disabled: ${controls.activation.reasonCode}`);
  addIf(!controls.download.enabled, blockers, 'artifact download disabled');
  addIf(manifest.status !== controls.selection.minimumSelectableState, blockers, `manifest state is ${manifest.status}; selection requires ${controls.selection.minimumSelectableState}`);
  for (const [approval, status] of Object.entries(controls.approvals)) {
    addIf(status !== 'approved', blockers, `${approval} control approval is ${status}`);
  }
  addIf(deviceEvidence.status !== 'approved', blockers, `device evidence is ${deviceEvidence.status}`);
  addIf(Date.parse(`${asOfDate}T00:00:00.000Z`) > Date.parse(controls.expiresAt), blockers, `controls expired at ${controls.expiresAt}`);

  if (controls.activation.enabled) {
    addIf(controls.activation.activeManifestId !== manifest.manifestId, errors, 'enabled controls must select this exact manifest ID');
    addIf(controls.activation.activeManifestSha256 === null, errors, 'enabled controls require the exact manifest file hash');
    addIf(controls.activation.revokedManifestIds.includes(manifest.manifestId), errors, 'enabled controls select a revoked manifest ID');
    addIf(Boolean(manifest.artifact.sha256) && controls.activation.revokedArtifactSha256.includes(manifest.artifact.sha256), errors, 'enabled controls select a revoked artifact hash');
  }

  return { errors, blockers };
}

export function validateTunedArtifactRepository({
  rootDir,
  paths = TUNED_ARTIFACT_PATHS,
  asOfDate = '2026-07-30',
  artifactPath,
} = {}) {
  if (!rootDir) throw new Error('rootDir is required');
  const resolvedPaths = Object.fromEntries(Object.entries(paths).map(([key, value]) => [key, path.resolve(rootDir, value)]));
  const documents = Object.fromEntries(Object.entries(resolvedPaths).map(([key, fullPath]) => [key, readJson(fullPath)]));
  const validators = compileValidators(rootDir);
  const errors = [];
  for (const key of Object.keys(TUNED_ARTIFACT_PATHS)) {
    errors.push(...schemaErrors(key, validators[key], documents[key]));
  }
  if (errors.length === 0) {
    const manifestSha256 = sha256File(resolvedPaths.manifest);
    const semantic = validateTunedArtifactDocuments({
      ...documents,
      controlsSha256: sha256File(resolvedPaths.controls),
      asOfDate,
    });
    errors.push(...semantic.errors);
    errors.push(...validateRuntimeBindings(rootDir, documents.manifest, manifestSha256));
    if (artifactPath) {
      errors.push(...validateArtifactFile(documents.manifest, artifactPath));
    }
    return { ok: errors.length === 0, errors, blockers: semantic.blockers, documents };
  }
  return { ok: false, errors, blockers: [], documents };
}

export function validateArtifactFile(manifest, artifactPath) {
  const errors = [];
  const expected = manifest.artifact;
  const info = fs.statSync(artifactPath);
  addIf(!info.isFile(), errors, 'artifact path must identify one regular file');
  addIf(path.basename(artifactPath) !== expected.fileName, errors, 'artifact file name does not match the manifest');
  addIf(info.size !== expected.sizeBytes, errors, 'artifact byte size does not match the manifest');
  addIf(sha256File(artifactPath) !== expected.sha256, errors, 'artifact SHA-256 does not match the manifest');
  return errors;
}
