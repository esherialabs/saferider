import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  TUNED_ARTIFACT_PATHS,
  sha256File,
  sourceBindsExactBundledManifestHash,
  validateArtifactFile,
  validateTunedArtifactDocuments,
  validateTunedArtifactRepository,
} from '../lib/saferide-tuned-artifact.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function baseline() {
  return {
    manifest: readJson(TUNED_ARTIFACT_PATHS.manifest),
    controls: readJson(TUNED_ARTIFACT_PATHS.controls),
    deviceEvidence: readJson(TUNED_ARTIFACT_PATHS.deviceEvidence),
  };
}

function clone(value) {
  return structuredClone(value);
}

test('accepts the exact manifest hash through the typed registry binding only', () => {
  const manifestSha256 = 'a'.repeat(64);
  const modelRegistry = `export const SAFERIDE_V058_TUNED_MANIFEST_SHA256 =\n  '${manifestSha256}';`;
  const selection = `export const TUNED_ARTIFACT_BUNDLED_MANIFEST_SHA256 =\n  SAFERIDE_V058_TUNED_MANIFEST_SHA256;`;

  assert.equal(sourceBindsExactBundledManifestHash({
    modelRegistry,
    selection,
    manifestSha256,
  }), true);
  assert.equal(sourceBindsExactBundledManifestHash({
    modelRegistry: modelRegistry.replace(manifestSha256, 'b'.repeat(64)),
    selection,
    manifestSha256,
  }), false);
  assert.equal(sourceBindsExactBundledManifestHash({
    modelRegistry,
    selection: selection.replace(
      'SAFERIDE_V058_TUNED_MANIFEST_SHA256',
      'UNRELATED_MANIFEST_SHA256',
    ),
    manifestSha256,
  }), false);
  assert.equal(sourceBindsExactBundledManifestHash({
    modelRegistry,
    selection,
    manifestSha256: 'not-a-sha256',
  }), false);
});

test('accepts the artifact-produced fail-closed bundle and reports external blockers', () => {
  const result = validateTunedArtifactRepository({ rootDir, asOfDate: '2026-08-10' });
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert(result.blockers.some(blocker => blocker.includes('activation disabled')));
  assert(result.blockers.some(blocker => blocker.includes('device evidence is in-review')));
});

test('rejects a skipped lifecycle state and a mutated shared policy', () => {
  const documents = baseline();
  documents.manifest.stateHistory.splice(1, 1);
  documents.manifest.controlPolicy.sha256 = '0'.repeat(64);
  const result = validateTunedArtifactDocuments({
    ...documents,
    controlsSha256: sha256File(path.join(rootDir, TUNED_ARTIFACT_PATHS.controls)),
    asOfDate: '2026-07-30',
  });
  assert(result.errors.some(error => error.includes('unskipped lifecycle prefix')));
  assert(result.errors.some(error => error.includes('exact controls file')));
});

test('rejects invented device results and public-sensitive diagnostic fields', () => {
  const documents = baseline();
  documents.deviceEvidence.status = 'blocked';
  documents.deviceEvidence.artifact = { manifestId: null, sha256: null, sizeBytes: null };
  documents.deviceEvidence.deviceMatrix[0].supportDecision = 'supported';
  documents.deviceEvidence.deviceMatrix[0].scenarios[0].status = 'passed';
  documents.deviceEvidence.deviceMatrix[0].prompt = 'synthetic but forbidden field';
  const result = validateTunedArtifactDocuments({
    ...documents,
    controlsSha256: sha256File(path.join(rootDir, TUNED_ARTIFACT_PATHS.controls)),
    asOfDate: '2026-07-30',
  });
  assert(result.errors.some(error => error.includes('forbidden public field')));
  assert(result.errors.some(error => error.includes('requires android-2-3gb to remain unverified')));
  assert(result.errors.some(error => error.includes('cannot claim android-2-3gb scenario results')));
});

test('verifies exact file name, size, and SHA-256 without accepting a same-size substitute', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-tuned-artifact-'));
  try {
    const artifactPath = path.join(directory, 'synthetic.litertlm');
    const bytes = Buffer.from('synthetic artifact bytes', 'utf8');
    fs.writeFileSync(artifactPath, bytes);
    const manifest = {
      artifact: {
        fileName: 'synthetic.litertlm',
        sizeBytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      },
    };
    assert.deepEqual(validateArtifactFile(manifest, artifactPath), []);

    const substitute = Buffer.from('tampered  artifact bytes', 'utf8');
    assert.equal(substitute.length, bytes.length);
    fs.writeFileSync(artifactPath, substitute);
    assert(validateArtifactFile(manifest, artifactPath).some(error => error.includes('SHA-256')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('rejects duplicate/incomplete device matrices and out-of-order state history', () => {
  const documents = baseline();
  documents.manifest.stateHistory[1].enteredAt = '2026-01-01T00:00:00.000Z';
  documents.deviceEvidence.deviceMatrix[1].deviceClass = documents.deviceEvidence.deviceMatrix[0].deviceClass;
  documents.deviceEvidence.deviceMatrix[0].scenarios.push(clone(documents.deviceEvidence.deviceMatrix[0].scenarios[0]));
  documents.deviceEvidence.deviceMatrix[2].scenarios.pop();
  const result = validateTunedArtifactDocuments({
    ...documents,
    controlsSha256: sha256File(path.join(rootDir, TUNED_ARTIFACT_PATHS.controls)),
    asOfDate: '2026-07-30',
  });
  for (const marker of ['timestamp', 'duplicate device class', 'duplicate scenario', 'every required reliability scenario']) {
    assert(result.errors.some(error => error.includes(marker)), marker);
  }
});

test('requires complete distinct review, privacy, device, and rollback evidence for approval', () => {
  const documents = baseline();
  documents.deviceEvidence.status = 'approved';
  documents.deviceEvidence.reviews = [
    { reviewerRole: 'mobile QA reviewer' },
    { reviewerRole: 'mobile QA reviewer' },
  ];
  const result = validateTunedArtifactDocuments({
    ...documents,
    controlsSha256: sha256File(path.join(rootDir, TUNED_ARTIFACT_PATHS.controls)),
    asOfDate: '2026-07-30',
  });
  for (const marker of ['clean prohibited-content', 'distinct reviewer roles', 'complete revocation', 'cannot leave android-2-3gb unverified', 'cannot leave android-2-3gb scenarios unrun']) {
    assert(result.errors.some(error => error.includes(marker)), marker);
  }
});

test('gates produced, Android-verified, revoked, expired, and enabled states', () => {
  const documents = baseline();
  documents.manifest.status = 'artifact-android-verified';
  documents.manifest.stateHistory.push({
    state: 'artifact-android-verified',
    enteredAt: '2026-08-10T11:00:00Z',
    evidenceRefs: [],
  });
  documents.controls.activation.enabled = true;
  documents.controls.activation.activeManifestId = 'wrong-manifest';
  documents.controls.activation.activeManifestSha256 = null;
  documents.controls.activation.revokedManifestIds = [documents.manifest.manifestId];
  documents.manifest.artifact.sha256 = 'b'.repeat(64);
  documents.manifest.artifact.sizeBytes = null;
  documents.manifest.artifact.immutableLocation = null;
  documents.deviceEvidence.artifact.manifestId = 'wrong-manifest';
  documents.controls.activation.revokedArtifactSha256 = [documents.manifest.artifact.sha256];
  const result = validateTunedArtifactDocuments({
    ...documents,
    controlsSha256: sha256File(path.join(rootDir, TUNED_ARTIFACT_PATHS.controls)),
    asOfDate: '2026-09-11',
  });
  for (const marker of ['exact immutable artifact identity', 'requires approved exact-artifact', 'manifest ID does not match', 'artifact hash does not match', 'expired', 'exact manifest ID', 'exact manifest file hash', 'revoked manifest ID', 'revoked artifact hash']) {
    assert([...result.errors, ...result.blockers].some(error => error.includes(marker)), marker);
  }

  documents.manifest.status = 'revoked';
  documents.manifest.stateHistory = documents.controls.lifecycleOrder.map((state, index) => ({
    state,
    enteredAt: `2026-07-30T${String(index).padStart(2, '0')}:00:00Z`,
    evidenceRefs: [],
  }));
  documents.controls.activation.enabled = false;
  documents.controls.activation.revokedManifestIds = [];
  documents.controls.activation.revokedArtifactSha256 = [];
  const revoked = validateTunedArtifactDocuments({
    ...documents,
    controlsSha256: sha256File(path.join(rootDir, TUNED_ARTIFACT_PATHS.controls)),
    asOfDate: '2026-07-30',
  });
  assert(revoked.errors.some(error => error.includes('must appear in a control revocation list')));
});

test('rejects invalid artifact path identity and repository inputs', () => {
  assert.throws(() => validateTunedArtifactRepository(), /rootDir is required/);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-tuned-artifact-paths-'));
  try {
    const artifactPath = path.join(directory, 'wrong-name.litertlm');
    fs.writeFileSync(artifactPath, 'tiny');
    const manifest = {
      artifact: {
        fileName: 'expected.litertlm',
        sizeBytes: 100,
        sha256: '0'.repeat(64),
      },
    };
    const errors = validateArtifactFile(manifest, artifactPath);
    assert(errors.some(error => error.includes('file name')));
    assert(errors.some(error => error.includes('byte size')));
    assert(errors.some(error => error.includes('SHA-256')));
    assert.throws(() => validateArtifactFile(manifest, directory), /EISDIR|illegal operation|is a directory/i);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
