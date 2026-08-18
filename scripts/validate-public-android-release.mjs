#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(root, 'schemas/public-android-release.schema.json');
const releasePath = path.join(root, 'web/public/releases/saferide-v0.5.8-android.json');
const checksumPath = path.join(
  root,
  'web/public/downloads/SafeRide-v0.5.8-Android-Preview-arm64.apk.sha256',
);

const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const release = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
const checksum = fs.readFileSync(checksumPath, 'utf8').trim();

const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  formats: {
    date: /^\d{4}-\d{2}-\d{2}$/,
    uri: /^https:\/\/[^\s]+$/,
  },
});
const validate = ajv.compile(schema);

if (!validate(release)) {
  console.error('Public Android release metadata is invalid:');
  for (const error of validate.errors ?? []) {
    console.error(`- ${error.instancePath || '/'} ${error.message}`);
  }
  process.exit(1);
}

const expectedChecksum = `${release.artifact.sha256}  ${release.artifact.fileName}`;
if (checksum !== expectedChecksum) {
  console.error(`Checksum file mismatch: expected ${expectedChecksum}`);
  process.exit(1);
}

if (release.artifact.downloadUrl.replace(/\.apk$/, '.apk.sha256') !== release.artifact.checksumUrl) {
  console.error('Checksum URL must be the APK URL plus .sha256.');
  process.exit(1);
}

console.log(
  `Public Android release metadata passed (${release.releaseName}; ${release.artifact.sizeBytes} bytes).`,
);
