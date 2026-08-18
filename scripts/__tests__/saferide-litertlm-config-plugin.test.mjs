import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { _internal } = require('../../plugins/withSafeRideLiteRtLm.js');

test('configures generated Gradle exactly once with LiteRT-LM 0.16.0', () => {
  const fixture = `apply plugin: "com.android.application"
def projectRoot = rootDir.getAbsoluteFile().getParentFile().getAbsolutePath()
android {
    defaultConfig {
        applicationId 'com.esheria.saferide.app'
    }
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            signingConfig signingConfigs.debug
        }
    }
}
dependencies {
    implementation("com.facebook.react:react-android")
}
`;
  const once = _internal.configureAppBuildGradle(fixture);
  const twice = _internal.configureAppBuildGradle(once);

  assert.equal(twice, once);
  assert.match(once, /saferide\.litertlm\.version/);
  assert.match(once, /0\.16\.0/);
  assert.match(once, /SAFERIDE_LITERTLM_REAL_RUNTIME_ALLOWED/);
  assert.match(once, /litertlm-android:\$\{safeRideLiteRtLmVersion\}/);
  assert.match(once, /SAFERIDE_REQUIRE_RELEASE_SIGNING/);
  assert.match(once, /saferideRelease/);
  assert.match(
    once,
    /signingConfig safeRideReleaseSigningConfigured \? signingConfigs\.saferideRelease : signingConfigs\.debug/,
  );
});

test('regenerates both Kotlin bridge files inside a clean Android project', () => {
  const platformRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-litertlm-plugin-'));
  try {
    _internal.copyKotlinBridge(platformRoot);
    for (const fileName of ['SafeRideLiteRtLmModule.kt', 'SafeRideLiteRtLmPackage.kt']) {
      const generatedPath = path.join(
        platformRoot,
        'app/src/main/java/com/esheria/saferide/app/localai',
        fileName,
      );
      const templatePath = path.join(
        repoRoot,
        'plugins/saferide-litertlm/android/src/main/java/com/esheria/saferide/app/localai',
        fileName,
      );
      assert.equal(fs.readFileSync(generatedPath, 'utf8'), fs.readFileSync(templatePath, 'utf8'));
    }
  } finally {
    fs.rmSync(platformRoot, { force: true, recursive: true });
  }
});

test('updates LiteRT-LM properties without dropping comments or unrelated entries', () => {
  const original = [
    { type: 'comment', value: '# keep this comment' },
    { type: 'property', key: 'unrelated.flag', value: 'true' },
    { type: 'property', key: 'saferide.litertlm.enabled', value: 'false' },
  ];
  const updated = _internal.upsertGradleProperty(
    original,
    'saferide.litertlm.enabled',
    'true',
  );
  assert.deepEqual(updated, [
    { type: 'comment', value: '# keep this comment' },
    { type: 'property', key: 'unrelated.flag', value: 'true' },
    { type: 'property', key: 'saferide.litertlm.enabled', value: 'true' },
  ]);
});

test('registers the React package in a generated Expo package list exactly once', () => {
  const fixture = `package com.esheria.saferide.app

import com.facebook.react.PackageList

class MainApplication {
  fun getPackages() = PackageList(this).packages.apply {
    // generated packages
  }
}
`;
  const once = _internal.configureMainApplication(fixture);
  const twice = _internal.configureMainApplication(once);

  assert.equal(twice, once);
  assert.equal((once.match(/import com\.esheria\.saferide\.app\.localai\.SafeRideLiteRtLmPackage/g) ?? []).length, 1);
  assert.equal((once.match(/add\(SafeRideLiteRtLmPackage\(\)\)/g) ?? []).length, 1);
});

test('keeps reflected LiteRT-LM classes and binds only exact registered artifacts', () => {
  const proguard = _internal.configureProguard('# base rules\n');
  assert.match(proguard, /-keep class com\.google\.ai\.edge\.litertlm\.\*\*/);

  const modulePath = path.join(
    repoRoot,
    'plugins/saferide-litertlm/android/src/main/java/com/esheria/saferide/app/localai/SafeRideLiteRtLmModule.kt',
  );
  const moduleSource = fs.readFileSync(modulePath, 'utf8');
  assert.match(moduleSource, /esherialabs\/saferide-gemma-4-e2b-v058-original-419806-litertlm/);
  assert.match(moduleSource, /5_071_837_136L/);
  assert.match(moduleSource, /8b73fd844464f220955eeedc474c30f39e621458c7a6b092de5afa2c3d027fcd/);
  assert.match(moduleSource, /ERR_LITERT_UNSUPPORTED_MANIFEST/);
});
