#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

import { getProviderPackReleaseBlockers, validateProviderPackBundle } from './lib/saferide-provider-pack.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.resolve(ROOT, relativePath), 'utf8'));
}

function readText(relativePath) {
  return fs.readFileSync(path.resolve(ROOT, relativePath), 'utf8');
}

export function validateProviderPackRuntimeImage(
  dockerfile = readText('apps/api/Dockerfile'),
) {
  const requiredCopies = [
    'COPY config/providers ./config/providers',
    'COPY data/providers ./data/providers',
  ];
  return requiredCopies
    .filter(required => !dockerfile.includes(required))
    .map(required => `API runtime image is missing: ${required}`);
}

function validator(schemaPath) {
  const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
  return ajv.compile(readJson(schemaPath));
}

const validatePackSchema = validator('schemas/provider-directory.schema.json');
const validateApprovalSchema = validator('schemas/provider-pack-approval.schema.json');

function errorsFor(validate, value, label) {
  if (validate(value)) return [];
  return (validate.errors ?? []).map(error => `${label}${error.instancePath || '$'} ${error.message ?? 'is invalid'}`);
}

export function readProviderPackBundle(overrides = {}) {
  return {
    pack: overrides.pack ?? readJson(overrides.packPath ?? 'data/providers/provider-pack.v1.json'),
    manifest: overrides.manifest ?? readJson(overrides.manifestPath ?? 'data/providers/provider-pack.v1.manifest.json'),
    controls: overrides.controls ?? readJson(overrides.controlsPath ?? 'config/providers/provider-pack-rollout.v1.json'),
    partnerApproval: overrides.partnerApproval ?? readJson(overrides.partnerPath ?? 'docs/providers/provider-partner-validation.pending.json'),
    attestation: overrides.attestation ?? readJson(overrides.attestationPath ?? 'docs/providers/provider-pack-attestation.pending.json'),
    now: overrides.now ?? new Date(),
  };
}

export function runProviderPackCheck(options = {}) {
  const bundle = readProviderPackBundle(options);
  const schemaErrors = errorsFor(validatePackSchema, bundle.pack, 'pack ');
  const approvalSchemaErrors = [
    ...errorsFor(validateApprovalSchema, bundle.partnerApproval, 'partner approval '),
    ...errorsFor(validateApprovalSchema, bundle.attestation, 'release attestation '),
  ];
  const enriched = { ...bundle, schemaErrors, approvalSchemaErrors };
  const errors = options.release
    ? getProviderPackReleaseBlockers(enriched)
    : validateProviderPackBundle(enriched);
  return { ...enriched, errors: [...errors, ...validateProviderPackRuntimeImage(options.dockerfile)] };
}

function valueAfter(flag) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const release = process.argv.includes('--release');
  const result = runProviderPackCheck({
    release,
    packPath: valueAfter('--pack'),
    manifestPath: valueAfter('--manifest'),
    controlsPath: valueAfter('--controls'),
    partnerPath: valueAfter('--partner-validation'),
    attestationPath: valueAfter('--attestation'),
  });
  if (result.errors.length) {
    console.error(`Provider pack ${release ? 'release ' : ''}check failed (${result.errors.length}):`);
    for (const error of result.errors) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`Provider pack ${release ? 'release ' : ''}check passed for ${result.pack.packId}@${result.pack.version}.`);
  }
}
