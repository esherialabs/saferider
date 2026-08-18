import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  canonicalSha256,
  compileEvaluationSchemas,
  parsePromptSuite,
  promptInventorySha256,
  scanPublicSafe,
  validateComparatorPlan,
  validateGenerationAgainstPlan,
  validateGenerationManifest,
} from '../lib/saferide-gemma4-evaluation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schemas = compileEvaluationSchemas(repoRoot);
const plan = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config/ai/evaluation/comparator-plan.v0.4.json'), 'utf8'));
const prompts = parsePromptSuite(fs.readFileSync(path.join(repoRoot, plan.promptSuite.path), 'utf8'));

function syntheticGeneration(slot = 'v03') {
  const artifact = plan.artifacts.find(item => item.slot === slot);
  return {
    schema: 'com.saferide.ai.private-generation-manifest',
    schemaVersion: 1,
    runMode: 'full',
    manifestId: `synthetic-${slot}`,
    evaluationRunId: `synthetic-${slot}-run`,
    createdAt: '2026-07-30T00:00:00.000Z',
    artifact: {
      slot,
      artifactClass: artifact.artifactClass,
      artifactId: artifact.artifactId,
      immutableRevision: artifact.immutableRevision,
      baseModelId: artifact.baseModelId,
      baseRevision: artifact.baseRevision,
      fileManifestSha256: artifact.fileManifestSha256,
    },
    promptSuite: {
      path: plan.promptSuite.path,
      sha256: plan.promptSuite.sha256,
      requiredPromptCount: prompts.length,
      selectedPromptCount: prompts.length,
      promptInventorySha256: promptInventorySha256(prompts),
    },
    rubric: plan.rubric,
    policy: { policyId: 'saferide-safe-assistant-v0.4', version: '0.4.0-candidate.1', sha256: plan.policy.sha256 },
    systemPrompt: {
      promptId: 'saferide-on-device-assistant-v1',
      configPath: plan.systemPrompt.path,
      configSha256: plan.systemPrompt.sha256,
      textSha256: plan.systemPrompt.textSha256,
    },
    generationConfig: plan.generationConfig,
    runtime: {
      engine: 'transformers-peft', pythonVersion: '3.12.0', packages: { torch: 'synthetic' },
      accelerator: { cudaAvailable: false, deviceCount: 0, deviceClass: 'cpu' },
    },
    privateBundle: {
      sha256: 'a'.repeat(64), sizeBytes: 1, reference: 'restricted-file:synthetic', accessOwnerRole: 'ML evidence owner',
    },
    rows: prompts.map(prompt => ({
      ...prompt,
      state: 'complete', inputTokens: 20, outputTokens: 20, hitTokenCap: false,
      stopReason: 'eos', latencyMs: 10, errorCode: null,
    })),
    privacy: {
      containsRawPrompts: false, containsRawCompletions: false,
      containsSurvivorData: false, containsExactLocations: false, publicSafe: true,
    },
  };
}

test('repository comparator plan is structurally valid while honestly blocked', () => {
  assert.equal(plan.status, 'blocked');
  assert.deepEqual(validateComparatorPlan(plan, schemas.plan, repoRoot, schemas.systemPrompt, schemas.artifactInventory), []);
  assert.equal(prompts.length, 120);
});

test('full generation binds every shared comparator input and immutable artifact field', () => {
  const generation = syntheticGeneration();
  assert.deepEqual(validateGenerationManifest(generation, prompts, schemas.generation, { requireFull: true }), []);
  assert.deepEqual(validateGenerationAgainstPlan(generation, plan), []);

  generation.generationConfig = { ...generation.generationConfig, maxNewTokens: 255 };
  assert.ok(validateGenerationAgainstPlan(generation, plan).some(error => error.includes('settings')));
});

test('token-cap row cannot masquerade as a complete comparator response', () => {
  const generation = syntheticGeneration();
  generation.rows[0] = { ...generation.rows[0], hitTokenCap: true, stopReason: 'token-cap' };
  assert.ok(validateGenerationManifest(generation, prompts, schemas.generation, { requireFull: true }).some(error => error.includes('cannot be complete')));
});

test('canonical hashing is key-order stable and public scanner rejects content fields', () => {
  assert.equal(canonicalSha256({ b: 2, a: { d: 4, c: 3 } }), canonicalSha256({ a: { c: 3, d: 4 }, b: 2 }));
  assert.ok(scanPublicSafe({ rows: [{ prompt_id: 'safe', raw_output: 'forbidden' }] }).some(error => error.includes('raw_output')));
});

test('safety CLI emits a schema-valid internal-only aggregate after policy approval', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saferide-eval-'));
  try {
    const bundlePath = path.join(tempDir, 'private-bundle.jsonl');
    fs.writeFileSync(bundlePath, '{"syntheticFixture":true}\n');
    const bundleBytes = fs.readFileSync(bundlePath);
    const generation = syntheticGeneration();
    generation.privateBundle = {
      sha256: crypto.createHash('sha256').update(bundleBytes).digest('hex'),
      sizeBytes: bundleBytes.length,
      reference: 'restricted-evidence:unit-test',
      accessOwnerRole: 'ML evidence owner',
    };
    const generationPath = path.join(tempDir, 'generation.json');
    fs.writeFileSync(generationPath, `${JSON.stringify(generation, null, 2)}\n`);
    const generationSha = crypto.createHash('sha256').update(fs.readFileSync(generationPath)).digest('hex');
    const makeReview = (role, key) => ({
      schema: 'com.saferide.ai.review-result',
      schemaVersion: 1,
      reviewId: `synthetic-${role}`,
      evaluationRunId: generation.evaluationRunId,
      artifactSlot: generation.artifact.slot,
      generationManifestSha256: generationSha,
      reviewer: {
        role,
        reviewerKey: key,
        identityEvidenceRef: `restricted-reviewer:${key}`,
        independenceAttested: true,
        completedAt: '2026-07-30T00:00:00.000Z',
      },
      rows: prompts.map(prompt => ({
        promptId: prompt.promptId,
        completionState: 'complete',
        score: 3,
        failureTypes: ['none'],
        criticalSignals: { hiddenPromptDisclosure: false, successfulPolicyExtraction: false, jailbreakSuccess: false },
        dimensions: { safety: 3, usefulness: 3, refusalQuality: 3, noNewFacts: 3, hallucination: false, overRefusal: false },
        sanitizedNoteCode: 'SAFE_PASS',
        mitigationId: null,
        retestId: null,
      })),
      privacy: { containsRawPrompt: false, containsRawCompletion: false, containsSurvivorData: false, containsExactLocation: false },
    });
    const productPath = path.join(tempDir, 'product.json');
    const technicalPath = path.join(tempDir, 'technical.json');
    const productReview = makeReview('product-safeguarding', 'reviewer-a');
    const technicalReview = makeReview('technical-ml', 'reviewer-b');
    fs.writeFileSync(productPath, `${JSON.stringify(productReview, null, 2)}\n`);
    fs.writeFileSync(technicalPath, `${JSON.stringify(technicalReview, null, 2)}\n`);
    const outputPath = path.join(tempDir, 'summary.json');
    const result = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/saferide-gemma4-safety-eval.mjs'),
      '--generation', generationPath,
      '--private-bundle', bundlePath,
      '--review', productPath,
      '--review', technicalPath,
      '--output', outputPath,
      '--allow-blocked',
    ], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(fs.readFileSync(outputPath, 'utf8'));
    assert.equal(summary.decision, 'internal-only');
    assert.deepEqual(summary.blockers, []);
    assert.deepEqual(schemaErrorsForSummary(summary), []);
    assert.deepEqual(scanPublicSafe(summary), []);

    productReview.rows[0].score = 1;
    productReview.rows[0].failureTypes = ['over-refusal'];
    productReview.rows[0].mitigationId = 'mitigation-1';
    technicalReview.rows[0].score = 1;
    technicalReview.rows[0].failureTypes = ['over-refusal'];
    technicalReview.rows[0].mitigationId = 'mitigation-1';
    fs.writeFileSync(productPath, `${JSON.stringify(productReview, null, 2)}\n`);
    fs.writeFileSync(technicalPath, `${JSON.stringify(technicalReview, null, 2)}\n`);
    const mitigationPath = path.join(tempDir, 'mitigation.json');
    fs.writeFileSync(mitigationPath, `${JSON.stringify({
      schema: 'com.saferide.ai.mitigation-retest',
      schemaVersion: 1,
      evaluationRunId: generation.evaluationRunId,
      artifactSlot: generation.artifact.slot,
      generationManifestSha256: generationSha,
      findings: [{
        mitigationId: 'mitigation-1', promptId: prompts[0].promptId, ownerRole: 'ML lead',
        targetVersion: 'synthetic-v2', status: 'retest-passed', retestId: 'retest-1',
        retestRunId: 'synthetic-retest-run', retestGenerationManifestSha256: 'b'.repeat(64),
        retestReviewResultSha256: ['c'.repeat(64), 'd'.repeat(64)], retestOutcome: 'passed',
      }],
      privacy: { containsRawPrompt: false, containsRawCompletion: false },
    }, null, 2)}\n`);
    const unverifiedRetest = spawnSync(process.execPath, [
      path.join(repoRoot, 'scripts/saferide-gemma4-safety-eval.mjs'),
      '--generation', generationPath,
      '--private-bundle', bundlePath,
      '--review', productPath,
      '--review', technicalPath,
      '--mitigation', mitigationPath,
      '--output', outputPath,
      '--allow-blocked',
    ], { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(unverifiedRetest.status, 1);
    assert.match(unverifiedRetest.stderr, /passed retest generation file is missing/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

function schemaErrorsForSummary(summary) {
  if (schemas.summary(summary)) return [];
  return schemas.summary.errors ?? [];
}
