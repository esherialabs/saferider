#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const STAGING_ORIGIN = 'https://d1wsat0xd3v4go.cloudfront.net';
const STAGING_HOST = 'd1wsat0xd3v4go.cloudfront.net';
const STAGING_STORAGE_HOST = 's3.eu-central-1.amazonaws.com';
const STAGING_STORAGE_BASE =
  'https://s3.eu-central-1.amazonaws.com/saferide-staging-api-runtime-evidencebucket-wr3fulb9om9k';
const BASE_GEMMA4_MODEL_ID = 'litert-community/gemma-4-E2B-it-litert-lm';
const V058_QA_MODEL_ID = 'esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm';
const V058_QA_MANIFEST_ID =
  'saferide-gemma4-e2b-v058-original-419806-litertlm-artifact-produced-2026-08-10.1';
const ANDROID_TUNED_MODEL_PROFILES = new Set([
  'preview',
  'android-release-apk',
  'android-internal-ai',
]);

const STAGING_PUBLIC_ENV = {
  EAS_BUILD_PROFILE: 'preview',
  EAS_BUILD_PLATFORM: 'android',
  EXPO_PUBLIC_ENVIRONMENT: 'staging',
  EXPO_PUBLIC_API_BASE_URL: `${STAGING_ORIGIN}/api`,
  EXPO_PUBLIC_AUTH_BASE_URL: `${STAGING_ORIGIN}/auth`,
  EXPO_PUBLIC_WS_BASE_URL: `wss://${STAGING_HOST}`,
  EXPO_PUBLIC_STORAGE_BASE_URL: STAGING_STORAGE_BASE,
  EXPO_PUBLIC_RUNTIME_CONFIG_URL: `${STAGING_ORIGIN}/api/config/runtime`,
  EXPO_PUBLIC_RELEASE_ENDPOINT_HOSTS: STAGING_HOST,
  EXPO_PUBLIC_RELEASE_STORAGE_HOSTS: STAGING_STORAGE_HOST,
  EXPO_PUBLIC_API_TIMEOUT_MS: '10000',
  EXPO_PUBLIC_CONFIG_REFRESH_SECONDS: '60',
  EXPO_PUBLIC_OPENAI_ENABLED: 'false',
  EXPO_PUBLIC_AZURE_OPENAI_TRANSCRIPTION_ENABLED: 'false',
  EXPO_PUBLIC_AZURE_OPENAI_ENDPOINT: '',
  EXPO_PUBLIC_AZURE_OPENAI_DEPLOYMENT: '',
  EXPO_PUBLIC_AZURE_OPENAI_API_VERSION: '',
};

const EXPECTED_APP = {
  name: 'Safe Ride',
  slug: 'saferide',
  scheme: 'saferide',
  version: '1.0.0',
  androidVersionCode: 2,
  androidPackage: 'com.esheria.saferide.app',
  iosBundleIdentifier: 'com.esheria.saferide.app',
  easProjectId: 'df299186-b444-414a-bae3-1e2c263c6927',
};

const EXPECTED_EAS_UPDATE_URL = `https://u.expo.dev/${EXPECTED_APP.easProjectId}`;
const EXPECTED_UPDATE_CHANNELS = {
  preview: 'preview',
  production: 'production',
};
const EXPECTED_EAS_ENVIRONMENTS = {
  preview: 'preview',
  'android-release-apk': 'preview',
  'android-internal-ai': 'preview',
};

const LOCAL_OR_PRIVATE_HOST =
  /\/\/(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|\[?::1\]?|[^/]+\.local)([:/]|$)/i;

const args = new Set(process.argv.slice(2));
const includeRemoteSmoke = args.has('--include-remote-smoke');
const jsonOutput = args.has('--json');
const help = args.has('--help') || args.has('-h');

if (help) {
  console.log(`Usage: node scripts/release-candidate-preflight.mjs [--include-remote-smoke] [--json]

Validates SafeRide preview release-candidate public config without starting EAS.

Options:
  --include-remote-smoke  Also run npm run smoke:owned-stack against CloudFront.
  --json                  Print the final summary as JSON.
`);
  process.exit(0);
}

function pass(message) {
  if (!jsonOutput) console.log(`PASS ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function stagingEnvForProfile(buildProfile) {
  const tunedModelProfile = ANDROID_TUNED_MODEL_PROFILES.has(buildProfile);
  return {
    ...STAGING_PUBLIC_ENV,
    EAS_BUILD_PROFILE: buildProfile,
    EXPO_PUBLIC_LOCAL_ASSISTANT_ENABLED: tunedModelProfile ? 'true' : 'false',
    EXPO_PUBLIC_LOCAL_ASSISTANT_PREFER_ON_DEVICE: tunedModelProfile ? 'true' : 'false',
    EXPO_PUBLIC_LOCAL_ASSISTANT_MODEL_ID: tunedModelProfile ? V058_QA_MODEL_ID : BASE_GEMMA4_MODEL_ID,
    EXPO_PUBLIC_LOCAL_ASSISTANT_ALLOW_REAL_LITERTLM_RUNTIME: tunedModelProfile ? 'true' : 'false',
    EXPO_PUBLIC_LOCAL_ASSISTANT_QA_TUNED_MANIFEST_ID: tunedModelProfile ? V058_QA_MANIFEST_ID : '',
  };
}

function setReleaseEnv(buildProfile = 'preview') {
  for (const [key, value] of Object.entries(stagingEnvForProfile(buildProfile))) {
    process.env[key] = value;
  }
}

function assertNoUnsafeRuntimeValues(value, context) {
  const serialized = JSON.stringify(value);
  assert(!serialized.toLowerCase().includes('supabase'), `${context} contains Supabase`);
  assert(!serialized.includes('http://'), `${context} contains http://`);
  assert(!serialized.includes('ws://'), `${context} contains ws://`);
  assert(!LOCAL_OR_PRIVATE_HOST.test(serialized), `${context} contains a local/private host`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function validatePackageJson() {
  const pkg = readJson('package.json');
  const lockfile = readJson('package-lock.json');
  assert(pkg.dependencies?.['expo-updates'], 'expo-updates dependency missing');
  assert(lockfile.packages?.['node_modules/expo-updates'], 'expo-updates lockfile entry missing');

  for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
    assert(!/\beas\s+update\b/.test(command), `package script ${name} must not publish EAS Update`);
  }

  pass('expo-updates dependency and scripts');
  return pkg;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const text = await response.text();
  if (!response.ok) {
    fail(`GET ${url} returned ${response.status}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`GET ${url} did not return JSON`);
  }
}

function validateEasJson() {
  const eas = readJson('eas.json');
  const resolveProfile = name => {
    const profile = eas.build?.[name];
    assert(profile, `${name} EAS build profile is missing`);
    if (!profile.extends) return profile;
    const parent = eas.build?.[profile.extends];
    assert(parent, `${name} extends missing EAS profile ${profile.extends}`);
    return {
      ...parent,
      ...profile,
      env: { ...(parent.env ?? {}), ...(profile.env ?? {}) },
      android: { ...(parent.android ?? {}), ...(profile.android ?? {}) },
      ios: { ...(parent.ios ?? {}), ...(profile.ios ?? {}) },
    };
  };
  const androidReleaseApk = resolveProfile('android-release-apk');
  const androidInternalAi = resolveProfile('android-internal-ai');
  assert(eas.cli?.appVersionSource === 'remote', 'EAS appVersionSource must remain remote');
  assert(eas.build?.preview?.env?.EXPO_PUBLIC_ENVIRONMENT === 'staging', 'preview profile must target staging');
  assert(eas.build?.preview?.android?.buildType === 'apk', 'preview Android build must produce an APK');
  assert(eas.build?.preview?.distribution === 'internal', 'preview build distribution must be internal');
  assert(eas.build?.preview?.channel === EXPECTED_UPDATE_CHANNELS.preview, 'preview build must use the preview EAS Update channel');
  assert(
    eas.build?.preview?.env?.EXPO_PUBLIC_LOCAL_ASSISTANT_MODEL_ID === V058_QA_MODEL_ID,
    'preview build must select the exact v0.5.8 QA model',
  );
  assert(
    eas.build?.preview?.env?.EXPO_PUBLIC_LOCAL_ASSISTANT_QA_TUNED_MANIFEST_ID === V058_QA_MANIFEST_ID,
    'preview build must select the exact v0.5.8 QA manifest',
  );
  assert(
    eas.build?.preview?.env?.SAFERIDE_LITERTLM_VERSION === '0.16.0',
    'preview build must pin LiteRT-LM 0.16.0',
  );
  assert(eas.build?.['android-release-apk']?.extends === 'preview', 'android-release-apk must extend preview');
  assert(androidReleaseApk.env?.EXPO_PUBLIC_ENVIRONMENT === 'staging', 'android-release-apk must target staging');
  assert(androidReleaseApk.env?.EXPO_PUBLIC_LOCAL_ASSISTANT_MODEL_ID === V058_QA_MODEL_ID, 'android-release-apk must select the exact v0.5.8 model');
  assert(androidReleaseApk.env?.EXPO_PUBLIC_LOCAL_ASSISTANT_QA_TUNED_MANIFEST_ID === V058_QA_MANIFEST_ID, 'android-release-apk must select the exact v0.5.8 manifest');
  assert(androidReleaseApk.env?.EXPO_PUBLIC_LOCAL_ASSISTANT_ALLOW_REAL_LITERTLM_RUNTIME === 'true', 'android-release-apk must enable the real LiteRT-LM runtime');
  assert(androidReleaseApk.environment === EXPECTED_EAS_ENVIRONMENTS['android-release-apk'], 'android-release-apk must load the preview EAS environment');
  assert(androidReleaseApk.distribution === 'internal', 'android-release-apk distribution must be internal');
  assert(androidReleaseApk.channel === EXPECTED_UPDATE_CHANNELS.preview, 'android-release-apk must use the preview update channel');
  assert(androidReleaseApk.android?.buildType === 'apk', 'android-release-apk must produce an APK');
  assert(androidReleaseApk.autoIncrement === true, 'android-release-apk must auto-increment');
  assert(eas.build?.['android-internal-ai']?.extends === 'preview', 'android-internal-ai must extend preview');
  assert(androidInternalAi.env?.EXPO_PUBLIC_ENVIRONMENT === 'staging', 'android-internal-ai must target staging');
  assert(androidInternalAi.env?.EXPO_PUBLIC_LOCAL_ASSISTANT_MODEL_ID === V058_QA_MODEL_ID, 'android-internal-ai must select the exact v0.5.8 model');
  assert(androidInternalAi.env?.EXPO_PUBLIC_LOCAL_ASSISTANT_QA_TUNED_MANIFEST_ID === V058_QA_MANIFEST_ID, 'android-internal-ai must select the exact v0.5.8 manifest');
  assert(androidInternalAi.env?.EXPO_PUBLIC_LOCAL_ASSISTANT_ALLOW_REAL_LITERTLM_RUNTIME === 'true', 'android-internal-ai must enable the real LiteRT-LM runtime');
  assert(androidInternalAi.environment === EXPECTED_EAS_ENVIRONMENTS['android-internal-ai'], 'android-internal-ai must load the preview EAS environment');
  assert(androidInternalAi.distribution === 'store', 'android-internal-ai distribution must be store');
  assert(androidInternalAi.channel === EXPECTED_UPDATE_CHANNELS.preview, 'android-internal-ai must use the preview update channel');
  assert(androidInternalAi.android?.buildType === 'app-bundle', 'android-internal-ai must produce an AAB');
  assert(androidInternalAi.autoIncrement === true, 'android-internal-ai must auto-increment');
  assert(eas.submit?.['android-internal-ai']?.android?.track === 'internal', 'android-internal-ai submit must target Google Play internal testing');
  assert(eas.build?.prerelease?.env?.EXPO_PUBLIC_ENVIRONMENT === 'staging', 'prerelease profile must target staging');
  assert(
    eas.build?.prerelease?.environment === EXPECTED_EAS_ENVIRONMENTS.preview,
    'prerelease profile must load the preview EAS environment',
  );
  assert(eas.build?.prerelease?.distribution === 'store', 'prerelease build distribution must be store');
  assert(eas.build?.prerelease?.channel === EXPECTED_UPDATE_CHANNELS.preview, 'prerelease build must use the preview EAS Update channel');
  assert(eas.build?.prerelease?.android?.buildType === 'app-bundle', 'prerelease Android build must produce an AAB');
  assert(eas.build?.prerelease?.ios?.simulator === false, 'prerelease iOS build must produce a device archive');
  assert(eas.build?.prerelease?.autoIncrement === true, 'prerelease profile must auto-increment');
  assert(eas.build?.production?.env?.EXPO_PUBLIC_ENVIRONMENT === 'production', 'production profile must target production');
  assert(eas.build?.production?.distribution === 'store', 'production profile must use store distribution');
  assert(eas.build?.production?.android?.buildType === 'app-bundle', 'production Android build must produce an AAB');
  assert(eas.build?.production?.ios?.simulator === false, 'production iOS build must produce a device archive');
  assert(eas.build?.production?.autoIncrement === true, 'production profile must auto-increment');
  assert(
    eas.build?.production?.channel === EXPECTED_UPDATE_CHANNELS.production,
    'production build must use the production EAS Update channel',
  );
  assert(eas.submit?.prerelease?.android?.track === 'internal', 'prerelease Android submit must target Google Play internal testing');
  assert(
    eas.submit?.prerelease?.ios && typeof eas.submit.prerelease.ios === 'object' && !Array.isArray(eas.submit.prerelease.ios),
    'prerelease iOS submit profile must exist for TestFlight',
  );
  assert(eas.submit?.production?.android?.track === 'internal', 'production Android submit must target Google Play internal testing');
  assert(
    eas.submit?.production?.ios && typeof eas.submit.production.ios === 'object' && !Array.isArray(eas.submit.production.ios),
    'production iOS submit profile must exist for TestFlight',
  );
  pass('eas profile shape');
  return eas;
}

function validateIosPrivacyUsageDescriptions(config) {
  const infoPlist = config.ios?.infoPlist;
  assert(infoPlist && typeof infoPlist === 'object', 'iOS Info.plist usage descriptions missing');
  for (const key of [
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
    'NSLocationWhenInUseUsageDescription',
    'NSPhotoLibraryUsageDescription',
  ]) {
    const value = infoPlist[key];
    assert(typeof value === 'string' && value.trim().length >= 20, `iOS ${key} must be a clear usage description`);
  }
  pass('iOS privacy usage descriptions');
}

function validateEasUpdateConfig(config) {
  assert(config.runtimeVersion?.policy === 'appVersion', 'runtimeVersion policy must be appVersion');
  assert(config.updates && typeof config.updates === 'object', 'Expo updates config missing');
  assert(config.updates.url === EXPECTED_EAS_UPDATE_URL, 'EAS Update URL must target the configured EAS project');
  assert(config.updates.enabled !== false, 'EAS Update must not be explicitly disabled');
  pass('eas update config');
}

function validateExpoConfig(expectedBuildProfile = 'preview') {
  const configFactory = require('../app.config.js');
  const config = configFactory({});

  assert(config.name === EXPECTED_APP.name, 'Expo app name changed');
  assert(config.slug === EXPECTED_APP.slug, 'Expo slug changed');
  assert(config.scheme === EXPECTED_APP.scheme, 'Expo scheme changed');
  assert(config.version === EXPECTED_APP.version, 'Expo version changed');
  assert(config.android?.package === EXPECTED_APP.androidPackage, 'Android package changed');
  assert(config.android?.versionCode === EXPECTED_APP.androidVersionCode, 'Android versionCode changed');
  assert(config.ios?.bundleIdentifier === EXPECTED_APP.iosBundleIdentifier, 'iOS bundle identifier changed');
  assert(config.extra?.eas?.projectId === EXPECTED_APP.easProjectId, 'EAS project id changed');
  validateEasUpdateConfig(config);
  validateIosPrivacyUsageDescriptions(config);

  assert(config.extra?.runtime?.environment === 'staging', 'runtime environment must resolve to staging');
  assert(config.extra?.runtime?.buildProfile === expectedBuildProfile, `runtime build profile must resolve to ${expectedBuildProfile}`);
  assert(config.extra?.runtime?.releaseLike === true, 'preview config must resolve as release-like');
  assert(config.extra?.runtime?.openAIEnabled === false, 'preview client must not enable direct OpenAI');
  assert(
    config.extra?.runtime?.releaseEndpointHosts?.includes(STAGING_HOST),
    'release endpoint host allowlist missing CloudFront host',
  );
  assert(
    config.extra?.runtime?.releaseStorageHosts?.includes(STAGING_STORAGE_HOST),
    'release storage host allowlist missing staging storage host',
  );
  assert(config.extra?.api?.baseUrl === STAGING_PUBLIC_ENV.EXPO_PUBLIC_API_BASE_URL, 'API URL mismatch');
  assert(config.extra?.auth?.baseUrl === STAGING_PUBLIC_ENV.EXPO_PUBLIC_AUTH_BASE_URL, 'auth URL mismatch');
  assert(config.extra?.websocket?.baseUrl === STAGING_PUBLIC_ENV.EXPO_PUBLIC_WS_BASE_URL, 'WebSocket URL mismatch');
  assert(config.extra?.storage?.baseUrl === STAGING_PUBLIC_ENV.EXPO_PUBLIC_STORAGE_BASE_URL, 'storage URL mismatch');
  assert(config.extra?.remoteConfig?.url === STAGING_PUBLIC_ENV.EXPO_PUBLIC_RUNTIME_CONFIG_URL, 'runtime config URL mismatch');
  assert(config.extra?.azureOpenAI?.transcriptionEnabled === false, 'direct Azure transcription must remain disabled');
  const tunedModelProfile = ANDROID_TUNED_MODEL_PROFILES.has(expectedBuildProfile);
  assert(config.extra?.localAssistant?.enabled === tunedModelProfile, `local AI enabled flag mismatch for ${expectedBuildProfile}`);
  assert(
    config.extra?.localAssistant?.preferOnDevice === tunedModelProfile,
    `local AI preference mismatch for ${expectedBuildProfile}`,
  );
  assert(
    config.extra?.localAssistant?.modelId === (tunedModelProfile ? V058_QA_MODEL_ID : BASE_GEMMA4_MODEL_ID),
    `local AI model mismatch for ${expectedBuildProfile}`,
  );
  assert(
    config.extra?.localAssistant?.qaTunedArtifactManifestId === (tunedModelProfile ? V058_QA_MANIFEST_ID : undefined),
    `local AI QA manifest mismatch for ${expectedBuildProfile}`,
  );
  assert(
    config.extra?.localAssistant?.allowRealLiteRtLmRuntime === tunedModelProfile,
    `real LiteRT runtime flag must ${tunedModelProfile ? '' : 'not '}be enabled for ${expectedBuildProfile}`,
  );
  assertNoUnsafeRuntimeValues(config.extra, 'Expo extra config');
  pass(`expo ${expectedBuildProfile} config`);
  return config;
}

async function validateRuntimeConfig() {
  const runtime = await fetchJson(STAGING_PUBLIC_ENV.EXPO_PUBLIC_RUNTIME_CONFIG_URL);
  assert(runtime.environment === 'staging', 'runtime config environment must be staging');
  assert(runtime.apiBaseUrl === STAGING_PUBLIC_ENV.EXPO_PUBLIC_API_BASE_URL, 'runtime API URL mismatch');
  assert(runtime.authBaseUrl === STAGING_PUBLIC_ENV.EXPO_PUBLIC_AUTH_BASE_URL, 'runtime auth URL mismatch');
  assert(runtime.wsBaseUrl === STAGING_PUBLIC_ENV.EXPO_PUBLIC_WS_BASE_URL, 'runtime WebSocket URL mismatch');
  assert(runtime.storageBaseUrl === STAGING_PUBLIC_ENV.EXPO_PUBLIC_STORAGE_BASE_URL, 'runtime storage URL mismatch');
  assert(runtime.features?.ownedApi === true, 'runtime config must advertise owned API');
  assert(runtime.features?.ownedStorage === true, 'runtime config must advertise owned storage');
  assert(runtime.features?.ownedRealtime === true, 'runtime config must advertise owned realtime');
  assert(runtime.features?.remoteTranscription === false, 'runtime config must not advertise remote transcription');
  assertNoUnsafeRuntimeValues(runtime, 'remote runtime config');
  pass('remote runtime config');
  return runtime;
}

function runRemoteSmoke() {
  const env = {
    ...process.env,
    SAFERIDE_SMOKE_API_ORIGIN: STAGING_ORIGIN,
    SAFERIDE_SMOKE_API_BASE: STAGING_PUBLIC_ENV.EXPO_PUBLIC_API_BASE_URL,
    SAFERIDE_SMOKE_AUTH_BASE: STAGING_PUBLIC_ENV.EXPO_PUBLIC_AUTH_BASE_URL,
    SAFERIDE_SMOKE_WS_BASE: STAGING_PUBLIC_ENV.EXPO_PUBLIC_WS_BASE_URL,
    SAFERIDE_SMOKE_SKIP_DB_AUDIT: '1',
  };
  const result = spawnSync(process.execPath, ['scripts/smoke-owned-stack.mjs'], {
    env,
    stdio: jsonOutput ? 'pipe' : 'inherit',
    windowsHide: true,
  });

  if (result.status !== 0) {
    if (jsonOutput) {
      process.stderr.write(result.stdout ?? '');
      process.stderr.write(result.stderr ?? '');
    }
    fail(`remote owned-stack smoke failed with exit code ${result.status}`);
  }

  pass('remote owned-stack smoke');
}

function approvalSummary() {
  return {
    previewBuildRequiresApproval: true,
    buildCommandAfterApproval: 'eas build --platform android --profile preview',
    prereleaseAndroidBuildRequiresApproval: true,
    prereleaseAndroidBuildCommandAfterApproval: 'eas build --platform android --profile prerelease',
    prereleaseAndroidSubmitRequiresApproval: true,
    prereleaseAndroidSubmitCommandAfterApproval: 'eas submit --platform android --profile prerelease --id <build-id>',
    androidReleaseApkBuildRequiresApproval: true,
    androidReleaseApkBuildCommandAfterApproval: 'eas build --platform android --profile android-release-apk',
    androidInternalAiBuildRequiresApproval: true,
    androidInternalAiBuildCommandAfterApproval: 'eas build --platform android --profile android-internal-ai',
    androidInternalAiSubmitRequiresApproval: true,
    androidInternalAiSubmitCommandAfterApproval: 'eas submit --platform android --profile android-internal-ai --id <build-id>',
    prereleaseIosBuildRequiresApproval: true,
    prereleaseIosBuildCommandAfterApproval: 'eas build --platform ios --profile prerelease',
    prereleaseIosSubmitRequiresApproval: true,
    prereleaseIosSubmitCommandAfterApproval: 'eas submit --platform ios --profile prerelease --id <build-id>',
    productionBuildRequiresApproval: true,
    productionBuildCommandAfterApproval: 'eas build --platform android --profile production',
    productionSubmitRequiresApproval: true,
    productionSubmitCommandAfterApproval: 'eas submit --platform android --profile production --latest',
    iosProductionBuildRequiresApproval: true,
    iosProductionBuildCommandAfterApproval: 'eas build --platform ios --profile production',
    iosProductionSubmitRequiresApproval: true,
    iosProductionSubmitCommandAfterApproval: 'eas submit --platform ios --profile production --id <build-id>',
    previewUpdateRequiresApproval: true,
    previewUpdateCommandAfterApproval: 'eas update --channel preview --message "<message>"',
    productionUpdateRequiresApproval: true,
    productionUpdateCommandAfterApproval: 'eas update --channel production --message "<message>"',
    productionUpdateRequiresCodeSigningOrWrittenRiskAcceptance: true,
    noEasBuildStartedByPreflight: true,
    noEasSubmitStartedByPreflight: true,
    noEasUpdatePublishedByPreflight: true,
  };
}

async function main() {
  setReleaseEnv('preview');
  const pkg = validatePackageJson();
  const eas = validateEasJson();
  const expo = validateExpoConfig('preview');
  setReleaseEnv('android-release-apk');
  validateExpoConfig('android-release-apk');
  setReleaseEnv('android-internal-ai');
  validateExpoConfig('android-internal-ai');
  setReleaseEnv('prerelease');
  validateExpoConfig('prerelease');
  const runtime = await validateRuntimeConfig();

  if (includeRemoteSmoke) {
    runRemoteSmoke();
  } else {
    pass('remote owned-stack smoke skipped');
  }

  const summary = {
    status: 'pass',
    profile: 'preview',
    branchExpectation: 'run from the reviewed SafeRide release branch or its current PR branch',
    app: {
      name: expo.name,
      slug: expo.slug,
      version: expo.version,
      androidPackage: expo.android?.package,
      iosBundleIdentifier: expo.ios?.bundleIdentifier,
      easProjectId: expo.extra?.eas?.projectId,
      runtimeVersionPolicy: expo.runtimeVersion?.policy,
      easUpdateUrl: expo.updates?.url,
      expoUpdatesDependency: pkg.dependencies?.['expo-updates'],
    },
    publicEnv: stagingEnvForProfile('preview'),
    eas: {
      appVersionSource: eas.cli?.appVersionSource,
      previewUpdateChannel: eas.build?.preview?.channel,
      previewAndroidBuildType: eas.build?.preview?.android?.buildType,
      previewDistribution: eas.build?.preview?.distribution,
      androidReleaseApkProfile: eas.build?.['android-release-apk'],
      androidInternalAiProfile: eas.build?.['android-internal-ai'],
      androidInternalAiSubmitTrack: eas.submit?.['android-internal-ai']?.android?.track,
      prereleaseEnvironment: eas.build?.prerelease?.environment,
      prereleaseUpdateChannel: eas.build?.prerelease?.channel,
      prereleaseAndroidBuildType: eas.build?.prerelease?.android?.buildType,
      prereleaseIosSimulator: eas.build?.prerelease?.ios?.simulator,
      prereleaseDistribution: eas.build?.prerelease?.distribution,
      prereleaseAutoIncrement: eas.build?.prerelease?.autoIncrement,
      prereleaseAndroidSubmitTrack: eas.submit?.prerelease?.android?.track,
      prereleaseIosSubmitConfigured: Boolean(eas.submit?.prerelease?.ios),
      productionUpdateChannel: eas.build?.production?.channel,
      productionAndroidBuildType: eas.build?.production?.android?.buildType,
      productionIosSimulator: eas.build?.production?.ios?.simulator,
      productionDistribution: eas.build?.production?.distribution,
      productionAutoIncrement: eas.build?.production?.autoIncrement,
      productionAndroidSubmitTrack: eas.submit?.production?.android?.track,
      productionIosSubmitConfigured: Boolean(eas.submit?.production?.ios),
    },
    runtimeFeatures: runtime.features,
    remoteSmoke: includeRemoteSmoke ? 'passed' : 'skipped',
    approval: approvalSummary(),
  };

  if (jsonOutput) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log('Release-candidate preflight passed. No EAS build was started.');
    console.log(`After explicit approval only: ${summary.approval.buildCommandAfterApproval}`);
    console.log(`After explicit approval only: ${summary.approval.prereleaseAndroidBuildCommandAfterApproval}`);
    console.log(`After explicit approval only: ${summary.approval.prereleaseAndroidSubmitCommandAfterApproval}`);
    console.log(`After explicit approval only: ${summary.approval.androidReleaseApkBuildCommandAfterApproval}`);
    console.log(`After explicit approval only: ${summary.approval.androidInternalAiBuildCommandAfterApproval}`);
    console.log(`After explicit approval only: ${summary.approval.androidInternalAiSubmitCommandAfterApproval}`);
    console.log(`After explicit approval only: ${summary.approval.prereleaseIosBuildCommandAfterApproval}`);
    console.log(`After explicit approval only: ${summary.approval.prereleaseIosSubmitCommandAfterApproval}`);
    console.log(`After explicit approval only: ${summary.approval.productionSubmitCommandAfterApproval}`);
    console.log(`After explicit approval only: ${summary.approval.iosProductionBuildCommandAfterApproval}`);
    console.log(`After explicit approval only: ${summary.approval.iosProductionSubmitCommandAfterApproval}`);
    console.log(`After explicit approval only: ${summary.approval.previewUpdateCommandAfterApproval}`);
    console.log(`After explicit approval only: ${summary.approval.productionUpdateCommandAfterApproval}`);
  }
}

main().catch(error => {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
});
