import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const v058ModelId = 'esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm';
const v058ManifestId =
  'saferide-gemma4-e2b-v058-original-419806-litertlm-artifact-produced-2026-08-10.1';

const baseEnv = {
  EAS_BUILD_PROFILE: 'preview',
  EAS_BUILD_PLATFORM: 'android',
  EXPO_PUBLIC_ENVIRONMENT: 'staging',
  EXPO_PUBLIC_API_BASE_URL: 'https://qa.saferide.invalid/api',
  EXPO_PUBLIC_AUTH_BASE_URL: 'https://qa.saferide.invalid/auth',
  EXPO_PUBLIC_WS_BASE_URL: 'wss://qa.saferide.invalid',
  EXPO_PUBLIC_STORAGE_BASE_URL: 'https://storage.saferide.invalid/models',
  EXPO_PUBLIC_RUNTIME_CONFIG_URL: 'https://qa.saferide.invalid/api/config/runtime',
  EXPO_PUBLIC_API_TIMEOUT_MS: '10000',
  EXPO_PUBLIC_CONFIG_REFRESH_SECONDS: '60',
  EXPO_PUBLIC_OPENAI_ENABLED: 'false',
  EXPO_PUBLIC_LOCAL_ASSISTANT_ENABLED: 'true',
  EXPO_PUBLIC_LOCAL_ASSISTANT_PREFER_ON_DEVICE: 'true',
  EXPO_PUBLIC_LOCAL_ASSISTANT_MODEL_ID: v058ModelId,
  EXPO_PUBLIC_LOCAL_ASSISTANT_ALLOW_REAL_LITERTLM_RUNTIME: 'true',
  EXPO_PUBLIC_LOCAL_ASSISTANT_QA_TUNED_MANIFEST_ID: v058ManifestId,
  EXPO_PUBLIC_AZURE_OPENAI_TRANSCRIPTION_ENABLED: 'false',
  EXPO_PUBLIC_RELEASE_ENDPOINT_HOSTS: 'qa.saferide.invalid',
  EXPO_PUBLIC_RELEASE_STORAGE_HOSTS: 'storage.saferide.invalid',
};

function evaluateConfig(overrides = {}) {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      "const value = require('./app.config.js')({}); process.stdout.write(JSON.stringify(value.extra.localAssistant));",
    ],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, ...baseEnv, ...overrides },
    },
  );
  return result;
}

test('rejects Android tuned-model profiles on iOS', () => {
  const result = evaluateConfig({
    EAS_BUILD_PROFILE: 'android-internal-ai',
    EAS_BUILD_PLATFORM: 'ios',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Android-only until the iOS Swift runtime is implemented/);
});

test('allows the exact v0.5.8 manifest only in staging preview QA', () => {
  const result = evaluateConfig();
  assert.equal(result.status, 0, result.stderr);
  const localAssistant = JSON.parse(result.stdout);
  assert.equal(localAssistant.modelId, v058ModelId);
  assert.equal(localAssistant.qaTunedArtifactManifestId, v058ManifestId);
  assert.equal(localAssistant.allowRealLiteRtLmRuntime, true);
});

for (const buildProfile of ['android-release-apk', 'android-internal-ai']) {
  test(`allows the exact v0.5.8 manifest in ${buildProfile}`, () => {
    const result = evaluateConfig({ EAS_BUILD_PROFILE: buildProfile });
    assert.equal(result.status, 0, result.stderr);
    const localAssistant = JSON.parse(result.stdout);
    assert.equal(localAssistant.modelId, v058ModelId);
    assert.equal(localAssistant.qaTunedArtifactManifestId, v058ManifestId);
    assert.equal(localAssistant.allowRealLiteRtLmRuntime, true);
  });
}

test('rejects the QA manifest in prerelease even when the model id is exact', () => {
  const result = evaluateConfig({
    EAS_BUILD_PROFILE: 'prerelease',
    EXPO_PUBLIC_LOCAL_ASSISTANT_ALLOW_REAL_LITERTLM_RUNTIME: 'false',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /allowed only for an approved staging Android tuned-model build/);
});

test('rejects a real LiteRT-LM runtime in production', () => {
  const result = evaluateConfig({
    EAS_BUILD_PROFILE: 'production',
    EXPO_PUBLIC_ENVIRONMENT: 'production',
    EXPO_PUBLIC_LOCAL_ASSISTANT_QA_TUNED_MANIFEST_ID: '',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not production or generic prerelease builds/);
});
