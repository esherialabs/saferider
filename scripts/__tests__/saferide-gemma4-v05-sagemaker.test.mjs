import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildLaunchPlan,
  buildTrainingJobSpec,
  fileSha256,
  validateInputManifest,
  validateSageMakerPolicy,
} from '../saferide-gemma4-v05-sagemaker.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const policy = JSON.parse(fs.readFileSync(path.join(
  repoRoot,
  'config/ai/training/saferide-gemma4-v05-sagemaker-policy.json',
), 'utf8'));
const sha = character => character.repeat(64);
const datasetCommit = '8de9b7a5b5105fc244dffe5cea31a34d85994ba2';
const launcherCommit = '1'.repeat(40);
const bucket = 'sagemaker-eu-central-1-123456789012';
const prefix = 'saferide/v05/sagemaker/inputs/saferide-v05-sagemaker-input-37ddc7503309/';

function modelFile(name, sizeBytes, hash = sha('a')) {
  return {
    path: name,
    sha256: hash,
    sizeBytes,
    s3Uri: `s3://${bucket}/${prefix}model/${name}`,
    versionId: `version-${name}`,
    etag: `etag-${name}`,
  };
}

function inputManifest() {
  const files = [
    modelFile('.gitattributes', 1570),
    modelFile('README.md', 26744),
    modelFile('chat_template.jinja', 17336),
    modelFile('config.json', 4954),
    modelFile('generation_config.json', 208),
    modelFile('model.safetensors', 10246621918, '2db5482b20d746879bb3ef79b5203e9075a2e2b98f54ec7c2f281c1477ddc550'),
    modelFile('processor_config.json', 1689),
    modelFile('tokenizer.json', 32169626, 'cc8d3a0ce36466ccc1278bf987df5f71db1719b9ca6b4118264f45cb627bfe0f'),
    modelFile('tokenizer_config.json', 2095),
  ];
  return {
    schema: 'com.saferide.ai.v05-sagemaker-input-manifest',
    schemaVersion: 1,
    manifestId: 'saferide-v05-sagemaker-input-37ddc7503309',
    createdAt: '2026-08-02T18:00:00.000Z',
    sourceCommit: datasetCommit,
    datasetId: 'saferide-synthetic-guidance-v0.5.0',
    region: 'eu-central-1',
    trainingArchive: {
      fileName: 'saferide-v05-sagemaker-input-37ddc7503309.tar.gz',
      sha256: sha('b'),
      sizeBytes: 900000,
      packageManifestSha256: sha('c'),
      topLevelDirectory: 'saferide-v05-sagemaker-input-37ddc7503309',
      s3Uri: `s3://${bucket}/${prefix}handoff/saferide-v05-sagemaker-input-37ddc7503309.tar.gz`,
      versionId: 'archive-version',
      etag: 'archive-etag',
    },
    baseModel: {
      modelId: 'google/gemma-4-E2B-it',
      revision: '70af34e20bd4b7a91f0de6b22675850c43922a03',
      totalBytes: files.reduce((total, file) => total + file.sizeBytes, 0),
      fileCount: files.length,
      files,
      s3Prefix: `s3://${bucket}/${prefix}model/`,
    },
    storage: {
      bucket,
      prefix,
      versioning: 'Enabled',
      serverSideEncryption: 'AES256',
      publicAccessBlocked: true,
    },
    exclusions: {
      qualityHoldout: true,
      safetyHoldout: true,
      blindPrompts: true,
      candidateContent: true,
      reviewLedgers: true,
      reviewerIdentities: true,
      credentials: true,
    },
    privacy: {
      classification: 'controlled-training-input',
      containsSurvivorData: false,
      containsCredentials: false,
      containsRestrictedEvaluationBytes: false,
    },
  };
}

function writeManifest(directory, manifest) {
  const target = path.join(directory, 'input-manifest.json');
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  return target;
}

function preflightPlan(directory, manifest) {
  const manifestPath = writeManifest(directory, manifest);
  return buildLaunchPlan({
    policy,
    inputManifest: manifest,
    inputManifestPath: manifestPath,
    inputManifestSha256: fileSha256(manifestPath),
    inputManifestS3Uri: `s3://${bucket}/${prefix}handoff/input-manifest.json`,
    inputManifestVersionId: 'manifest-version',
    datasetSourceCommit: datasetCommit,
    launcherSourceCommit: launcherCommit,
    runKind: 'preflight',
    runId: 'saferide-v05-preflight-20260802-01',
    seed: 419805,
    learningRate: 1e-5,
    roleArn: 'arn:aws:iam::123456789012:role/SafeRideSageMakerTrainingRole',
    imageUri: '123456789012.dkr.ecr.eu-central-1.amazonaws.com/saferide/gemma4-v05:commit-111111111111',
    imageDigest: sha('d'),
    outputS3Uri: `s3://${bucket}/saferide/v05/sagemaker/runs/preflight/output/`,
    checkpointS3Uri: `s3://${bucket}/saferide/v05/sagemaker/runs/preflight/checkpoints/`,
    createdAt: '2026-08-02T18:30:00.000Z',
  });
}

test('SageMaker policy and immutable input manifest pass fail-closed contracts', () => {
  assert.deepEqual(validateSageMakerPolicy(policy), []);
  assert.deepEqual(validateInputManifest(inputManifest()), []);
  const bad = inputManifest();
  bad.baseModel.files[0].path = 'reviews/private.json';
  assert.match(validateInputManifest(bad).join('\n'), /forbidden training classification/);
});

test('preflight plan binds separate dataset and launcher commits plus actual manifest bytes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-sagemaker-plan-'));
  const manifest = inputManifest();
  const plan = preflightPlan(directory, manifest);
  assert.equal(plan.datasetSourceCommit, datasetCommit);
  assert.equal(plan.launcherSourceCommit, launcherCommit);
  assert.equal(plan.hyperparameters.maxSteps, 1);
  assert.equal(plan.inputManifest.sha256, fileSha256(path.join(directory, 'input-manifest.json')));
  assert.throws(() => buildLaunchPlan({
    ...{
      policy, inputManifest: manifest, inputManifestPath: path.join(directory, 'input-manifest.json'),
      inputManifestSha256: sha('0'), inputManifestS3Uri: plan.inputManifest.s3Uri,
      inputManifestVersionId: 'manifest-version', datasetSourceCommit: datasetCommit,
      launcherSourceCommit: launcherCommit, runKind: 'preflight', runId: plan.runId, seed: 419805,
      learningRate: 1e-5, roleArn: plan.roleArn, imageUri: plan.image.uri,
      imageDigest: plan.image.digest, outputS3Uri: plan.output.s3Uri,
      checkpointS3Uri: plan.output.checkpointS3Uri,
    },
  }), /hash is missing or stale/);
});

test('job spec is offline, checkpointed, encrypted, and one-step for real-model preflight', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-sagemaker-spec-'));
  const manifest = inputManifest();
  const plan = preflightPlan(directory, manifest);
  const manifestPath = path.join(directory, 'input-manifest.json');
  const spec = buildTrainingJobSpec(plan, manifest, fileSha256(manifestPath));
  assert.deepEqual(spec.InputDataConfig.map(channel => channel.ChannelName), ['handoff', 'model']);
  assert.equal(spec.EnableNetworkIsolation, true);
  assert.equal(spec.EnableInterContainerTrafficEncryption, true);
  assert.equal(spec.CheckpointConfig.LocalPath, '/opt/ml/checkpoints');
  assert.equal(spec.HyperParameters['max-steps'], '1');
  assert.equal(spec.HyperParameters.seed, '419805');
  assert.equal(spec.ResourceConfig.InstanceType, 'ml.g5.xlarge');
  assert.equal(spec.Environment.SAFERIDE_DATASET_SOURCE_COMMIT, datasetCommit);
  assert.equal(spec.Environment.SAFERIDE_LAUNCHER_SOURCE_COMMIT, launcherCommit);
});

test('second candidate seed cannot launch without the first run lineage', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-sagemaker-pair-'));
  const manifest = inputManifest();
  const manifestPath = writeManifest(directory, manifest);
  assert.throws(() => buildLaunchPlan({
    policy,
    inputManifest: manifest,
    inputManifestPath: manifestPath,
    inputManifestSha256: fileSha256(manifestPath),
    inputManifestS3Uri: `s3://${bucket}/${prefix}handoff/input-manifest.json`,
    inputManifestVersionId: 'manifest-version',
    datasetSourceCommit: datasetCommit,
    launcherSourceCommit: launcherCommit,
    runKind: 'candidate',
    runId: 'saferide-v05-candidate-seed-b-20260802',
    seed: 419806,
    learningRate: 1e-5,
    roleArn: 'arn:aws:iam::123456789012:role/SafeRideSageMakerTrainingRole',
    imageUri: '123456789012.dkr.ecr.eu-central-1.amazonaws.com/saferide/gemma4-v05:commit-111111111111',
    imageDigest: sha('d'),
    outputS3Uri: `s3://${bucket}/saferide/v05/sagemaker/runs/candidate/output/`,
    checkpointS3Uri: `s3://${bucket}/saferide/v05/sagemaker/runs/candidate/checkpoints/`,
  }), /must bind the first candidate run/);
});
