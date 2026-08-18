#!/usr/bin/env node
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  TUNED_ARTIFACT_PATHS,
  validateTunedArtifactRepository,
} from './lib/saferide-tuned-artifact.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
  const args = {
    release: false,
    allowBlocked: false,
    json: false,
    asOfDate: '2026-07-30',
    artifactPath: undefined,
    paths: { ...TUNED_ARTIFACT_PATHS },
  };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--release') args.release = true;
    else if (value === '--allow-blocked') args.allowBlocked = true;
    else if (value === '--json') args.json = true;
    else if (value === '--as-of') args.asOfDate = argv[++index];
    else if (value === '--artifact') args.artifactPath = path.resolve(argv[++index]);
    else if (value === '--manifest') args.paths.manifest = path.resolve(argv[++index]);
    else if (value === '--controls') args.paths.controls = path.resolve(argv[++index]);
    else if (value === '--device-evidence') args.paths.deviceEvidence = path.resolve(argv[++index]);
    else throw new Error(`Unknown argument: ${value}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.asOfDate)) throw new Error('--as-of must use YYYY-MM-DD');
  return args;
}

try {
  const args = parseArgs(process.argv.slice(2));
  const result = validateTunedArtifactRepository({
    rootDir,
    paths: args.paths,
    asOfDate: args.asOfDate,
    artifactPath: args.artifactPath,
  });
  const report = {
    schema: 'com.saferide.tuned-artifact-gate-report',
    schemaVersion: 1,
    valid: result.ok,
    releaseReady: result.ok && result.blockers.length === 0,
    manifestId: result.documents.manifest.manifestId,
    lifecycleState: result.documents.manifest.status,
    activationEnabled: result.documents.controls.activation.enabled,
    deviceEvidenceStatus: result.documents.deviceEvidence.status,
    errors: result.errors,
    blockers: result.blockers,
  };
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`SafeRide tuned artifact gate: ${report.valid ? 'VALID' : 'INVALID'}`);
    console.log(`Lifecycle: ${report.lifecycleState}`);
    console.log(`Release: ${report.releaseReady ? 'READY' : 'BLOCKED'}`);
    for (const error of report.errors) console.log(`ERROR: ${error}`);
    for (const blocker of report.blockers) console.log(`BLOCKER: ${blocker}`);
  }
  if (!result.ok || (args.release && result.blockers.length > 0 && !args.allowBlocked)) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
