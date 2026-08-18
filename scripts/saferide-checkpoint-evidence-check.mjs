#!/usr/bin/env node
import process from 'node:process';

import { runStructuredEvidenceCli } from './lib/saferide-structured-evidence-cli.mjs';

try {
  process.exitCode = runStructuredEvidenceCli({
    title: 'SafeRide UNICEF checkpoint evidence check',
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
