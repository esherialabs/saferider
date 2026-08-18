import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CATEGORIES,
  canonicalSha256,
  compileV05Schemas,
  jsonlText,
  readJson,
  schemaErrors,
  sha256,
} from '../lib/saferide-gemma4-v05.mjs';
import { inspectArtifactPermissions } from '../lib/saferide-artifact-security.mjs';
import {
  assembleScenarioMatrix,
  createDraftScenarioContent,
  createScenarioBlueprints,
  freezeDiff,
  scenarioMetrics,
} from '../saferide-gemma4-v05-scenario-matrix.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scriptPath = path.join(repoRoot, 'scripts/saferide-gemma4-v05-scenario-matrix.mjs');
const planPath = path.join(repoRoot, 'config/ai/datasets/saferide-gemma4-v05-plan.json');
const targetsPath = path.join(repoRoot, 'config/ai/datasets/saferide-gemma4-v05-scenario-targets.json');
const plan = readJson(planPath);
const targets = readJson(targetsPath);
const schemas = compileV05Schemas();
const blueprints = createScenarioBlueprints(plan, targets, schemas);
const content = createDraftScenarioContent(blueprints, targets, schemas);
const scenarios = assembleScenarioMatrix(blueprints, content, targets, schemas);

function clone(value) {
  return structuredClone(value);
}

function metricsFor(input) {
  return scenarioMetrics({
    plan,
    targets,
    scenarios: input,
    scenarioSha256: sha256(jsonlText(input)),
    planSha256: sha256(fs.readFileSync(planPath)),
    targetsSha256: sha256(fs.readFileSync(targetsPath)),
    schemas,
  });
}

test('scenario target configuration and deterministic scaffold satisfy the exact 1,300-family design', () => {
  assert.deepEqual(schemaErrors('targets', schemas.scenarioTargets, targets), []);
  assert.equal(blueprints.length, 1300);
  assert.equal(new Set(blueprints.map(entry => entry.scenarioFamilyId)).size, 1300);
  assert.equal(new Set(blueprints.map(entry => entry.semanticClusterId)).size, 1300);
  for (const category of CATEGORIES) {
    assert.equal(blueprints.filter(entry => entry.primaryCategory === category).length, 130);
  }
  assert.equal(blueprints.filter(entry => entry.behaviorFlags.safeNextStep).length * 2, 1800);
  assert.equal(blueprints.filter(entry => entry.behaviorFlags.pureRefusal).length * 2, 200);
  assert.equal(blueprints.filter(entry => entry.behaviorFlags.counterfactual).length * 2, 600);
  assert.equal(blueprints.filter(entry => entry.projectedAssignment.split === 'safety-holdout'
    && ['high', 'critical'].includes(entry.riskLevel)).length * 2, 400);
  const rerun = createScenarioBlueprints(plan, targets, schemas);
  assert.equal(jsonlText(rerun), jsonlText(blueprints));
});

test('content scaffold and assembly are byte-stable regardless of input order', () => {
  assert.equal(content.length, 1300);
  assert.equal(scenarios.length, 1300);
  assert.equal(new Set(content.map(entry => entry.blueprintSha256)).size, 1300);
  const reversedContent = createDraftScenarioContent([...blueprints].reverse(), targets, schemas);
  const reversedScenarios = assembleScenarioMatrix([...blueprints].reverse(), [...content].reverse(), targets, schemas);
  assert.equal(jsonlText(reversedContent), jsonlText(content));
  assert.equal(jsonlText(reversedScenarios), jsonlText(scenarios));
});

test('strict scenario metrics cover heatmaps, privacy, redundancy, behavior, and deterministic split feasibility', () => {
  const report = metricsFor(scenarios);
  assert.equal(report.passed, true);
  assert.deepEqual(report.failedCells, []);
  assert.equal(report.integrity.canonicalRecordCount, 1300);
  assert.equal(report.behaviors.safeNextStep, 1800);
  assert.equal(report.behaviors.pureRefusal, 200);
  assert.equal(report.safetyHoldoutFeasibility.projectedRows, 400);
  assert.equal(report.redundancy.duplicateNormalizedUserGoals, 0);
  assert.equal(report.redundancy.duplicateNormalizedUnsafePressure, 0);
  assert.equal(Object.keys(report.heatmaps.categoryRisk).length, 10);
  assert.equal(report.externalApprovalBlocked, true);
  assert.deepEqual(schemaErrors('metrics', schemas.scenarioMetrics, report), []);
  assert.doesNotMatch(JSON.stringify(report.failedCells), /family-[0-9]/);
});

test('matrix gates reject duplicate IDs, missing categories, bad behavior totals, invalid policy IDs, and content leakage', () => {
  const duplicateBlueprints = clone(blueprints);
  duplicateBlueprints[1].scenarioFamilyId = duplicateBlueprints[0].scenarioFamilyId;
  assert.throws(() => assembleScenarioMatrix(duplicateBlueprints, content, targets, schemas), /unique|missing|unknown|hash/i);

  assert.throws(() => metricsFor(scenarios.slice(1)), /scenario families|Scenario assignment failed/i);

  const badBehavior = clone(scenarios);
  badBehavior[0].behaviorFlags.safeNextStep = !badBehavior[0].behaviorFlags.safeNextStep;
  const behaviorReport = metricsFor(badBehavior);
  assert.equal(behaviorReport.passed, false);
  assert.match(behaviorReport.failedCells.join('\n'), /behavior:safeNextStep|blueprint-drift/);

  const badPolicy = clone(scenarios);
  badPolicy[0].policyRefs = ['POLICY-UNREVIEWED'];
  const policyReport = metricsFor(badPolicy);
  assert.equal(policyReport.passed, false);
  assert.match(policyReport.failedCells.join('\n'), /policy:unknown|blueprint-drift/);

  const leakedContent = clone(content);
  leakedContent[0].userGoal = 'contact synthetic.person@example.org';
  assert.throws(() => assembleScenarioMatrix(blueprints, leakedContent, targets, schemas), /email-address|scenario content failed/i);
});

test('freeze diff permits approval metadata only and rejects meaning drift or missing evidence', () => {
  const frozen = clone(scenarios).map(scenario => ({
    ...scenario,
    matrixReview: { status: 'approved', evidenceRef: `fixture:matrix:${scenario.scenarioFamilyId}` },
  }));
  const passing = freezeDiff(scenarios, frozen, 'a'.repeat(64), 'b'.repeat(64), schemas);
  assert.equal(passing.passed, true);
  assert.equal(passing.meaningChangeCount, 0);
  assert.equal(passing.approvalOnlyChangeCount, 1300);
  assert.deepEqual(schemaErrors('freezeDiff', schemas.scenarioFreezeDiff, passing), []);

  const drifted = clone(frozen);
  drifted[0].riskLevel = drifted[0].riskLevel === 'high' ? 'critical' : 'high';
  drifted[1].matrixReview.evidenceRef = null;
  const blocked = freezeDiff(scenarios, drifted, 'a'.repeat(64), 'c'.repeat(64), schemas);
  assert.equal(blocked.passed, false);
  assert.equal(blocked.meaningChangeCount, 1);
  assert.equal(blocked.missingApprovalCount, 1);
});

test('CLI is portable, enforces an external root, and writes 0700/0600 deterministic artifacts', { timeout: 30_000 }, () => {
  const help = spawnSync(process.execPath, [scriptPath, '--help'], { cwd: os.tmpdir(), encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /scaffold/);
  assert.match(help.stdout, /freeze-diff/);

  const rejected = spawnSync(process.execPath, [scriptPath, 'scaffold', '--artifact-root', repoRoot, '--output', 'matrix/test.jsonl'], {
    cwd: os.tmpdir(), encoding: 'utf8',
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /outside the repository/);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-v05-scenario-cli-'));
  try {
    const commands = [
      ['scaffold', '--output', 'matrix/scenario-blueprints.draft.jsonl'],
      ['content-scaffold', '--blueprints', 'matrix/scenario-blueprints.draft.jsonl', '--output', 'matrix/scenario-content.draft.jsonl'],
      ['assemble', '--blueprints', 'matrix/scenario-blueprints.draft.jsonl', '--content', 'matrix/scenario-content.draft.jsonl', '--output', 'matrix/scenarios.draft.jsonl'],
      ['metrics', '--scenarios', 'matrix/scenarios.draft.jsonl', '--output', 'matrix/scenario-metrics.draft.json', '--strict'],
    ];
    for (const command of commands) {
      const result = spawnSync(process.execPath, [scriptPath, ...command, '--artifact-root', root], {
        cwd: os.tmpdir(), encoding: 'utf8',
      });
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
      assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /synthetic design cell|unsafePressure|userGoal/);
    }
    assert.deepEqual(inspectArtifactPermissions(root), []);
    const output = fs.readFileSync(path.join(root, 'matrix/scenarios.draft.jsonl'));
    assert.equal(canonicalSha256(JSON.parse(output.toString('utf8').split('\n')[0])), canonicalSha256(scenarios[0]));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
