#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultNotebook = path.join(repoRoot, 'notebooks/saferide-gemma4-e2b-colab-v04-candidate.ipynb');
const defaultRequirements = path.join(repoRoot, 'requirements-ai-smoke.txt');
const defaultConstraints = path.join(repoRoot, 'constraints-ai-training.txt');
const forbiddenEmbeddedLogic = [
  /\bTrainer\s*\(/,
  /\bTrainingArguments\s*\(/,
  /\bget_peft_model\s*\(/,
  /\bapply_chat_template\s*\(/,
  /\bmodel\.generate\s*\(/,
  /DataCollator/,
];
const secretLike = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/,
];

function normalizedPackageName(value) {
  return value.toLowerCase().replace(/[-_.]+/g, '-');
}

function parseExactPins(contents, label) {
  const errors = [];
  const pins = new Map();
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^([A-Za-z0-9_.-]+)==([A-Za-z0-9][A-Za-z0-9.+!_-]*)$/);
    if (!match) {
      errors.push(`${label} line ${index + 1} must be one exact package==version pin`);
      continue;
    }
    const name = normalizedPackageName(match[1]);
    if (pins.has(name)) errors.push(`${label} duplicates package ${name}`);
    pins.set(name, match[2]);
  }
  return { errors, pins };
}

export function validateTrainingConstraints(requirementsText, constraintsText) {
  const requirements = parseExactPins(requirementsText, 'requirements-ai-smoke.txt');
  const constraints = parseExactPins(constraintsText, 'constraints-ai-training.txt');
  const errors = [...requirements.errors, ...constraints.errors];
  for (const [name, version] of requirements.pins) {
    if (constraints.pins.get(name) !== version) {
      errors.push(`constraints-ai-training.txt must pin ${name}==${version}`);
    }
  }
  if (constraints.pins.size <= requirements.pins.size) {
    errors.push('constraints-ai-training.txt must lock transitive dependencies, not only direct packages');
  }
  if (!constraintsText.includes('pip-compile with Python 3.12')) {
    errors.push('constraints-ai-training.txt must identify the Python 3.12 lock environment');
  }
  if (!constraintsText.includes('pip-tools==7.5.2')) {
    errors.push('constraints-ai-training.txt must identify the pinned resolver version');
  }
  return errors;
}

export function validateV04Notebook(notebook) {
  const errors = [];
  if (notebook.nbformat !== 4) errors.push('nbformat must be 4');
  if (!Array.isArray(notebook.cells) || notebook.cells.length < 8) errors.push('notebook must contain the controlled handoff cells');
  const codeCells = (notebook.cells ?? []).filter(cell => cell.cell_type === 'code');
  const combined = codeCells.map(cell => (cell.source ?? []).join('')).join('\n');
  codeCells.forEach((cell, index) => {
    if (cell.execution_count !== null) errors.push(`code cell ${index} must have null execution_count`);
    if (!Array.isArray(cell.outputs) || cell.outputs.length !== 0) errors.push(`code cell ${index} must have no saved output`);
  });
  for (const pattern of forbiddenEmbeddedLogic) {
    if (pattern.test(combined)) errors.push(`notebook embeds runner logic matching ${pattern}`);
  }
  for (const pattern of secretLike) {
    if (pattern.test(combined)) errors.push('notebook contains secret-like material');
  }
  const requirements = [
    ['explicit approved-run gate', "SAFERIDE_APPROVED_COLAB_RUN"],
    ['immutable repository revision', 'SAFERIDE_REPO_REVISION'],
    ['immutable base revision', 'SAFERIDE_BASE_REVISION'],
    ['exact direct dependency declaration', "requirements-ai-smoke.txt"],
    ['exact transitive dependency constraints', "constraints-ai-training.txt"],
    ['Python 3.12 dependency environment', "sys.version_info[:2] != (3, 12)"],
    ['strict data gate', "--for-finetuning"],
    ['strict safe-assistant policy gate', "saferide-ai-policy-check.mjs"],
    ['offline assistant-loss gradient smoke', "saferide-gemma4-assistant-loss-smoke.py"],
    ['dataset audit', "--audit"],
    ['repository training runner', "saferide-gemma4-finetune-runner.py"],
    ['candidate run kind', "'candidate'"],
    ['content-free manifest validator', "saferide-ai-training-run-check.mjs"],
    ['secrets scan', "secrets:scan"],
    ['private Colab secret access', "userdata.get('HF_TOKEN')"],
  ];
  for (const [label, text] of requirements) {
    if (!combined.includes(text)) errors.push(`notebook is missing ${label}`);
  }
  const runnerInvocations = (combined.match(/saferide-gemma4-finetune-runner\.py/g) ?? []).length;
  if (runnerInvocations !== 1) errors.push(`notebook must invoke the repository runner exactly once (found ${runnerInvocations})`);
  if (/pip[^\n]*(?:transformers|peft|datasets|torch)/i.test(combined)) {
    errors.push('notebook must not duplicate ML dependency selection outside the repository requirements file');
  }
  if (!/pip[^\n]*['"]-c['"][^\n]*constraints/i.test(combined)) {
    errors.push('notebook must install with the exact repository constraints file');
  }
  return errors;
}

function main() {
  const notebookPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultNotebook;
  const notebook = JSON.parse(fs.readFileSync(notebookPath, 'utf8'));
  const errors = [
    ...validateV04Notebook(notebook),
    ...validateTrainingConstraints(
      fs.readFileSync(defaultRequirements, 'utf8'),
      fs.readFileSync(defaultConstraints, 'utf8'),
    ),
  ];
  console.log('SafeRide Gemma 4 v0.4 thin Colab notebook check');
  console.log(`Notebook: ${path.relative(repoRoot, notebookPath) || notebookPath}`);
  if (errors.length) {
    errors.forEach(error => console.error(`- ${error}`));
    return 1;
  }
  console.log('PASS (thin orchestration; saved outputs=0; training remains approval-gated)');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
