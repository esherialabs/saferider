#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  UNICEF_GO_NO_GO_PATHS,
  serializeUnicefGoNoGoDecision,
  validateUnicefGoNoGo,
} from './lib/saferide-unicef-go-no-go.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = new Set(process.argv.slice(2));
const release = args.has('--release');
const write = args.has('--write');

const result = validateUnicefGoNoGo({ rootDir, release, checkDecision: !write });

if (result.errors.length > 0) {
  console.error(`UNICEF go/no-go structure failed with ${result.errors.length} error(s):`);
  for (const error of result.errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else if (write) {
  const destination = path.join(rootDir, UNICEF_GO_NO_GO_PATHS.decision);
  fs.writeFileSync(destination, serializeUnicefGoNoGoDecision(result.decision), 'utf8');
  console.log(`Wrote fail-closed UNICEF go/no-go decision: ${UNICEF_GO_NO_GO_PATHS.decision}`);
} else if (release && result.blockers.length > 0) {
  console.error(`UNICEF checkpoint is blocked by ${result.blockers.length} fail-closed gate(s):`);
  for (const blocker of result.blockers) console.error(`- ${blocker}`);
  process.exitCode = 1;
} else {
  const mapped = result.decision.repositoryCoverage.tableRequirementIdsMapped;
  const units = result.decision.repositoryCoverage.coverageUnitsMapped;
  const milestones = result.decision.repositoryCoverage.requiredMilestonesMapped;
  console.log(`UNICEF go/no-go structure passed (${mapped} PRD requirement IDs mapped, ${units} coverage units, ${milestones} milestones mapped).`);
  console.log(`Decision: ${result.decision.decision.toUpperCase()}; ${result.blockers.length} explicit checkpoint blocker(s).`);
}
