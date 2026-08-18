#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  canonicalSha256,
  compileEvaluationSchemas,
  fileSha256,
  parsePromptSuite,
  scanPublicSafe,
  schemaErrors,
  validateComparatorPlan,
  validateGenerationAgainstPlan,
  validateGenerationManifest,
} from './lib/saferide-gemma4-evaluation.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return [
    'Usage: node scripts/saferide-gemma4-eval-compare.mjs --check',
    '       --generation base=<manifest> --generation v03=<manifest> --generation <target>=<manifest>',
    '       [--summary base=<json> --summary v03=<json> --summary <target>=<json>]',
    '       [--output <json>] [--allow-blocked]',
    '',
    'The comparison consumes only public-safe manifests and aggregate summaries; it never reads raw generation content.',
  ].join('\n');
}

function parseArgs(argv) {
  const args = {
    plan: 'config/ai/evaluation/comparator-plan.v0.4.json',
    output: '.ai-smoke/gemma4-evaluation/public-safe-comparison.json',
    generations: [],
    summaries: [],
    check: false,
    allowBlocked: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--check') args.check = true;
    else if (argument === '--allow-blocked') args.allowBlocked = true;
    else if (argument === '--plan') args.plan = argv[++index];
    else if (argument === '--output') args.output = argv[++index];
    else if (argument === '--generation') args.generations.push(argv[++index]);
    else if (argument === '--summary') args.summaries.push(argv[++index]);
    else if (['--help', '-h'].includes(argument)) {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`Unknown or incomplete argument: ${argument}\n\n${usage()}`);
  }
  return args;
}

function resolve(input) {
  return path.isAbsolute(input) ? input : path.join(repoRoot, input);
}

function readJson(input) {
  return JSON.parse(fs.readFileSync(resolve(input), 'utf8'));
}

function parseSlotMappings(values, label, requiredSlots) {
  const result = new Map();
  for (const value of values) {
    const separator = value?.indexOf('=') ?? -1;
    if (separator < 1) throw new Error(`${label} must use slot=path`);
    const slot = value.slice(0, separator);
    const file = value.slice(separator + 1);
    if (!requiredSlots.includes(slot) || !file) throw new Error(`${label} has invalid slot or path: ${value}`);
    if (result.has(slot)) throw new Error(`${label} repeats ${slot}`);
    result.set(slot, file);
  }
  return result;
}

function assertAllSlots(mapping, label, requiredSlots) {
  if (mapping.size !== requiredSlots.length || requiredSlots.some(slot => !mapping.has(slot))) {
    throw new Error(`${label} requires exactly one ${requiredSlots.join(', ')} input`);
  }
}

function structuralCheck(plan, schemas, prompts) {
  const errors = validateComparatorPlan(plan, schemas.plan, repoRoot, schemas.systemPrompt, schemas.artifactInventory);
  if (prompts.length !== 120) errors.push(`prompt suite has ${prompts.length}/120 prompts`);
  console.log(`SafeRide base/v0.3/${plan.targetSlot ?? 'v04'} comparator structural check`);
  if (errors.length) {
    errors.forEach(error => console.error(`- ${error}`));
    return 1;
  }
  console.log(`PASS (plan=${plan.status}; blockers=${plan.blockers.length}; no raw generations read)`);
  return 0;
}

function runComparison(args, plan, schemas, prompts) {
  const targetSlot = plan.targetSlot ?? 'v04';
  const requiredSlots = plan.artifacts.map(artifact => artifact.slot);
  const generationMappings = parseSlotMappings(args.generations, '--generation', requiredSlots);
  const summaryMappings = parseSlotMappings(args.summaries, '--summary', requiredSlots);
  assertAllSlots(generationMappings, 'Comparator generation', requiredSlots);
  if (summaryMappings.size !== 0) assertAllSlots(summaryMappings, 'Comparator summary', requiredSlots);

  const errors = validateComparatorPlan(plan, schemas.plan, repoRoot, schemas.systemPrompt, schemas.artifactInventory);
  const blockers = [];
  const generations = new Map();
  for (const slot of requiredSlots) {
    const file = resolve(generationMappings.get(slot));
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    generations.set(slot, { manifest, file, sha256: fileSha256(file) });
    errors.push(...validateGenerationManifest(manifest, prompts, schemas.generation, { requireFull: true }).map(error => `${slot}: ${error}`));
    errors.push(...validateGenerationAgainstPlan(manifest, plan).map(error => `${slot}: ${error}`));
    if (manifest.artifact?.slot !== slot) errors.push(`${slot}: manifest slot mismatch`);
  }

  const baseManifest = generations.get('base').manifest;
  for (const slot of requiredSlots.slice(1)) {
    const manifest = generations.get(slot).manifest;
    for (const [label, left, right] of [
      ['prompt suite', baseManifest.promptSuite, manifest.promptSuite],
      ['rubric', baseManifest.rubric, manifest.rubric],
      ['policy', baseManifest.policy, manifest.policy],
      ['system prompt', baseManifest.systemPrompt, manifest.systemPrompt],
      ['generation settings', baseManifest.generationConfig, manifest.generationConfig],
    ]) {
      if (canonicalSha256(left) !== canonicalSha256(right)) errors.push(`${slot}: ${label} differs from base comparator input`);
    }
  }
  if (errors.length) throw new Error(`Comparator inputs failed:\n- ${errors.join('\n- ')}`);

  const summaries = new Map();
  if (summaryMappings.size === 0) {
    blockers.push('All three artifacts require complete two-reviewer aggregate summaries.');
  } else {
    for (const slot of requiredSlots) {
      const file = resolve(summaryMappings.get(slot));
      const summary = JSON.parse(fs.readFileSync(file, 'utf8'));
      summaries.set(slot, { summary, file, sha256: fileSha256(file) });
      const summaryErrors = [...schemaErrors(`${slot} summary`, schemas.summary, summary), ...scanPublicSafe(summary, `${slot} summary`)];
      if (summary.artifact?.slot !== slot) summaryErrors.push(`${slot} summary artifact slot mismatch`);
      if (summary.inputs?.generationManifestSha256 !== generations.get(slot).sha256) summaryErrors.push(`${slot} summary generation hash mismatch`);
      if (summary.artifact?.immutableRevision !== generations.get(slot).manifest.artifact.immutableRevision) summaryErrors.push(`${slot} summary artifact revision mismatch`);
      if (summaryErrors.length) throw new Error(`Comparator summary failed:\n- ${summaryErrors.join('\n- ')}`);
      if (summary.decision !== 'internal-only') blockers.push(`${slot} evaluation remains ${summary.decision}.`);
    }
  }

  for (const slot of requiredSlots) {
    const rows = generations.get(slot).manifest.rows;
    const complete = rows.filter(row => row.state === 'complete').length;
    const truncated = rows.filter(row => row.state === 'truncated').length;
    const rowErrors = rows.filter(row => row.state === 'error').length;
    if (complete !== prompts.length || truncated || rowErrors) blockers.push(`${slot} generation is incomplete (${complete}/${prompts.length}, truncated=${truncated}, errors=${rowErrors}).`);
  }

  const baseSummary = summaries.get('base')?.summary ?? null;
  const targetSummary = summaries.get(targetSlot)?.summary ?? null;
  const safetyDelta = Number.isFinite(baseSummary?.scores.safety) && Number.isFinite(targetSummary?.scores.safety)
    ? targetSummary.scores.safety - baseSummary.scores.safety
    : null;
  const usefulnessDelta = Number.isFinite(baseSummary?.scores.usefulness) && Number.isFinite(targetSummary?.scores.usefulness)
    ? targetSummary.scores.usefulness - baseSummary.scores.usefulness
    : null;
  const meaningfulRegression = safetyDelta === null || usefulnessDelta === null
    ? null
    : safetyDelta < -plan.maximumRegressionPoints || usefulnessDelta < -plan.maximumRegressionPoints;
  if (meaningfulRegression) blockers.push(`${targetSlot} regresses more than ${plan.maximumRegressionPoints} points from base safety or usefulness.`);
  if (plan.status === 'blocked') blockers.push('Comparator plan retains unresolved artifact, approval, or human-review blockers.');

  const artifactRows = requiredSlots.map(slot => {
    const generation = generations.get(slot);
    const summary = summaries.get(slot);
    const rows = generation.manifest.rows;
    return {
      slot,
      artifactId: generation.manifest.artifact.artifactId,
      immutableRevision: generation.manifest.artifact.immutableRevision,
      generationManifestSha256: generation.sha256,
      evaluationSummarySha256: summary?.sha256 ?? null,
      complete: rows.filter(row => row.state === 'complete').length,
      truncated: rows.filter(row => row.state === 'truncated').length,
      errors: rows.filter(row => row.state === 'error').length,
      decision: summary?.summary.decision ?? 'awaiting-reviews',
      scores: {
        overall: summary?.summary.scores.overall ?? null,
        safety: summary?.summary.scores.safety ?? null,
        usefulness: summary?.summary.scores.usefulness ?? null,
      },
    };
  });
  const comparison = {
    schema: 'com.saferide.ai.comparison-summary',
    schemaVersion: 1,
    comparisonId: `${plan.planId}-public-comparison`,
    createdAt: new Date().toISOString(),
    planId: plan.planId,
    planSha256: fileSha256(resolve(args.plan)),
    commonInputs: {
      promptSuiteSha256: baseManifest.promptSuite.sha256,
      promptInventorySha256: baseManifest.promptSuite.promptInventorySha256,
      rubricSha256: baseManifest.rubric.sha256,
      policySha256: baseManifest.policy.sha256,
      systemPromptTextSha256: baseManifest.systemPrompt.textSha256,
      generationConfigSha256: canonicalSha256(baseManifest.generationConfig),
    },
    artifacts: artifactRows,
    regressions: {
      maximumAllowedPoints: plan.maximumRegressionPoints,
      targetSlot,
      targetVsBaseSafety: safetyDelta,
      targetVsBaseUsefulness: usefulnessDelta,
      ...(targetSlot === 'v04' ? { v04VsBaseSafety: safetyDelta, v04VsBaseUsefulness: usefulnessDelta } : {}),
      meaningfulRegression,
    },
    decision: blockers.length ? 'blocked' : 'internal-comparison-only',
    blockers: [...new Set(blockers)],
    limitations: [
      'Adapter comparison is not tuned-mobile-artifact or physical-device proof.',
      'Internal comparison is not checkpoint, production, release, UNICEF, partner, legal, or survivor readiness.',
      'Raw synthetic prompts, completions, and reviewer notes remain restricted and are not represented here.',
    ],
    privacy: {
      containsRawPrompts: false,
      containsRawCompletions: false,
      classification: 'public-safe-aggregate',
    },
  };
  const outputErrors = [...schemaErrors('comparison', schemas.comparison, comparison), ...scanPublicSafe(comparison, 'comparison')];
  if (outputErrors.length) throw new Error(`Generated comparison failed:\n- ${outputErrors.join('\n- ')}`);
  const outputPath = resolve(args.output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(comparison, null, 2)}\n`, { mode: 0o600 });
  console.log(`SafeRide comparator decision: ${comparison.decision}.`);
  console.log(`Public-safe output: ${path.relative(repoRoot, outputPath) || outputPath}`);
  console.log('No raw prompts, completions, or reviewer notes were read.');
  return comparison.decision === 'blocked' && !args.allowBlocked ? 1 : 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const schemas = compileEvaluationSchemas(repoRoot);
  const plan = readJson(args.plan);
  const prompts = parsePromptSuite(fs.readFileSync(resolve(plan.promptSuite.path), 'utf8'));
  if (args.check || args.generations.length === 0) return structuralCheck(plan, schemas, prompts);
  return runComparison(args, plan, schemas, prompts);
}

try {
  process.exitCode = main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
