import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validateTrainingConstraints, validateV04Notebook } from '../saferide-gemma4-v04-notebook-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const notebook = JSON.parse(fs.readFileSync(
  path.join(repoRoot, 'notebooks/saferide-gemma4-e2b-colab-v04-candidate.ipynb'),
  'utf8',
));
const requirements = fs.readFileSync(path.join(repoRoot, 'requirements-ai-smoke.txt'), 'utf8');
const constraints = fs.readFileSync(path.join(repoRoot, 'constraints-ai-training.txt'), 'utf8');

test('v0.4 notebook is a clean thin orchestrator', () => {
  assert.deepEqual(validateV04Notebook(notebook), []);
});

test('saved output is rejected', () => {
  const changed = structuredClone(notebook);
  const cell = changed.cells.find(item => item.cell_type === 'code');
  cell.outputs = [{ output_type: 'stream', name: 'stdout', text: ['private output'] }];
  assert.ok(validateV04Notebook(changed).some(error => error.includes('saved output')));
});

test('embedded training implementation is rejected', () => {
  const changed = structuredClone(notebook);
  const cell = changed.cells.find(item => item.cell_type === 'code');
  cell.source.push('trainer = Trainer(model=model)\n');
  assert.ok(validateV04Notebook(changed).some(error => error.includes('embeds runner logic')));
});

test('the Python 3.12 training dependency graph is exactly constrained', () => {
  assert.deepEqual(validateTrainingConstraints(requirements, constraints), []);
  assert.ok(validateTrainingConstraints(
    requirements.replace('torch==2.7.0', 'torch>=2.7.0'),
    constraints,
  ).some(error => error.includes('exact package==version pin')));
  assert.ok(validateTrainingConstraints(
    requirements,
    constraints.replace('torch==2.7.0', 'torch==2.8.0'),
  ).some(error => error.includes('must pin torch==2.7.0')));
});
