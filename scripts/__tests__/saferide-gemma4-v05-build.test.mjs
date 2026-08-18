import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  CATEGORIES,
  LANGUAGES,
  assignScenarioFamilies,
  compileV05Schemas,
  jsonlText,
  schemaErrors,
  validateCandidateSet,
  validatePlanSemantics,
  validatePrivateOutputRoot,
  validateSplitManifestSemantics,
} from '../lib/saferide-gemma4-v05.mjs';
import { validateBuiltRows, validateScenarioMatrix } from '../saferide-gemma4-v05-build.mjs';
import {
  clone,
  makeApprovedFixture,
  makeScenarioSpecs,
  makeSplitManifest,
  v05Plan,
} from './helpers/saferide-v05-fixtures.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = makeApprovedFixture();

test('v0.5 plan and deterministic assignment enforce every exact quota and family isolation', () => {
  assert.deepEqual(validatePlanSemantics(fixture.plan), []);
  assert.equal(fixture.manifest.assignments.length, 1300);
  assert.equal(new Set(fixture.manifest.assignments.map(entry => entry.scenarioFamilyId)).size, 1300);
  assert.equal(new Set(fixture.manifest.assignments.flatMap(entry => Object.values(entry.rowIds))).size, 2600);
  assert.deepEqual(validateSplitManifestSemantics(fixture.manifest, fixture.plan, fixture.specs), []);
  for (const split of fixture.plan.splits) {
    const assigned = fixture.manifest.assignments.filter(entry => entry.split === split.name);
    assert.equal(assigned.length, split.families);
    for (const category of CATEGORIES) {
      const cell = assigned.filter(entry => entry.primaryCategory === category);
      assert.equal(cell.length, split.familiesPerCategory);
      assert.equal(cell.filter(entry => entry.conversationForm === 'single-turn').length, split.conversationFormRowsPerCategoryLanguage['single-turn']);
      assert.equal(cell.filter(entry => entry.conversationForm === 'multi-turn').length, split.conversationFormRowsPerCategoryLanguage['multi-turn']);
    }
  }
  const rerun = assignScenarioFamilies([...fixture.specs].reverse(), fixture.plan, {
    status: fixture.manifest.status,
    manifestId: fixture.manifest.manifestId,
    planSha256: fixture.manifest.planSha256,
    scenarioSpecSha256: fixture.manifest.scenarioSpecSha256,
    approvals: fixture.manifest.approvals,
  });
  assert.deepEqual(rerun.assignments, fixture.manifest.assignments);
});

test('approved fixture builds exactly 2,600 hash-bound rows and a 320-row train-only pilot', () => {
  assert.equal(fixture.rows.length, 2600);
  assert.equal(fixture.reviewSummary.finalRowCount, 2600);
  assert.equal(fixture.pilotRowIds.length, 320);
  const rowById = new Map(fixture.rows.map(row => [row.id, row]));
  for (const rowId of fixture.pilotRowIds) assert.equal(rowById.get(rowId)?.split, 'train');
  for (const language of LANGUAGES) {
    assert.equal(fixture.rows.filter(row => row.metadata.language === language).length, 1300);
  }
  assert.deepEqual(validateBuiltRows(fixture.rows, fixture.plan, fixture.systemPrompt.textSha256), []);
});

test('candidate import fails closed on split, provenance, status, privacy, and scenario drift', () => {
  const candidates = clone(fixture.candidates);
  candidates[0].split = 'safety-holdout';
  candidates[1].stage = 'final';
  candidates[2].metadata.appState = 'received-confirmed';
  candidates[3].authoring.syntheticOnlyAttested = false;
  candidates[4].messages[0].content += ' person@example.org';
  const result = validateCandidateSet(candidates, fixture.specs, fixture.manifest, fixture.plan, { schemas: compileV05Schemas() });
  assert.match(result.errors.join('\n'), /split differs/);
  assert.match(result.errors.join('\n'), /stage=candidate/);
  assert.match(result.errors.join('\n'), /app state differs/);
  assert.match(result.errors.join('\n'), /synthetic-only|must be equal to constant/);
  assert.match(result.errors.join('\n'), /email-address/);
});

test('controlled and restricted outputs cannot be written into public repository paths', () => {
  const publicPath = path.join(repoRoot, 'data/ai/private.jsonl');
  const ignoredSmokePath = path.join(repoRoot, '.ai-smoke/v05/private.jsonl');
  const externalPath = path.join(os.tmpdir(), 'saferide-v05/private.jsonl');
  assert.throws(() => validatePrivateOutputRoot(publicPath), /only outside the repository/);
  assert.equal(validatePrivateOutputRoot(ignoredSmokePath), ignoredSmokePath);
  assert.equal(validatePrivateOutputRoot(externalPath), externalPath);
});

test('scenario matrix rejects a missing family before prose generation', () => {
  const plan = v05Plan();
  const specs = makeScenarioSpecs(plan).slice(1);
  assert.throws(() => makeSplitManifest(specs, plan), /scenario families/);
});

test('scenario matrix rejects private identifiers before authoring jobs are created', () => {
  const specs = clone(fixture.specs);
  specs[0].userGoal = 'contact person@example.org';
  assert.match(validateScenarioMatrix(specs, fixture.plan).join('\n'), /email-address/);
});

test('CLI build writes public-safe, controlled, and restricted artifacts into separate directories', { timeout: 30_000 }, () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-v05-build-test-'));
  try {
    const inputs = path.join(temporary, 'inputs');
    const output = path.join(temporary, 'artifacts');
    fs.mkdirSync(inputs, { recursive: true, mode: 0o700 });
    const paths = {
      scenarios: path.join(inputs, 'scenarios.jsonl'), splitManifest: path.join(inputs, 'split.json'),
      candidates: path.join(inputs, 'candidates.jsonl'), reviews: path.join(inputs, 'reviews.jsonl'),
      policy: path.join(inputs, 'policy.json'), systemPrompt: path.join(inputs, 'prompt.json'),
    };
    fs.writeFileSync(paths.scenarios, jsonlText(fixture.specs), { mode: 0o600 });
    fs.writeFileSync(paths.splitManifest, `${JSON.stringify(fixture.manifest)}\n`, { mode: 0o600 });
    fs.writeFileSync(paths.candidates, jsonlText(fixture.candidates), { mode: 0o600 });
    fs.writeFileSync(paths.reviews, jsonlText(fixture.reviews), { mode: 0o600 });
    fs.writeFileSync(paths.policy, `${JSON.stringify(fixture.policy)}\n`, { mode: 0o600 });
    fs.writeFileSync(paths.systemPrompt, `${JSON.stringify(fixture.systemPrompt)}\n`, { mode: 0o600 });
    const result = spawnSync(process.execPath, [
      'scripts/saferide-gemma4-v05-build.mjs', 'build',
      '--scenarios', paths.scenarios, '--split-manifest', paths.splitManifest,
      '--candidates', paths.candidates, '--reviews', paths.reviews,
      '--policy', paths.policy, '--system-prompt', paths.systemPrompt, '--output-dir', output,
    ], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    for (const relative of [
      'controlled/train.jsonl', 'controlled/dev.jsonl', 'controlled/pilot-row-manifest.json',
      'restricted/quality-holdout.jsonl', 'restricted/safety-holdout.jsonl', 'restricted/review-summary.json',
      'public-safe/dataset-manifest.json',
    ]) assert.equal(fs.existsSync(path.join(output, relative)), true, relative);
    const manifest = JSON.parse(fs.readFileSync(path.join(output, 'public-safe/dataset-manifest.json'), 'utf8'));
    assert.deepEqual(schemaErrors('manifest', compileV05Schemas().datasetManifest, manifest), []);
    assert.deepEqual(manifest.files.map(file => file.path), [
      'controlled/train.jsonl', 'controlled/dev.jsonl',
      'restricted/quality-holdout.jsonl', 'restricted/safety-holdout.jsonl',
    ]);
    assert.equal(fs.statSync(path.join(output, 'restricted/review-summary.json')).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
});
