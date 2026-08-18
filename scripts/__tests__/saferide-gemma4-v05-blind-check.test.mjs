import assert from 'node:assert/strict';
import test from 'node:test';

import { compileV05Schemas, validateBlindEvaluation } from '../lib/saferide-gemma4-v05.mjs';
import { clone, makeApprovedFixture, makeBlindPrompts } from './helpers/saferide-v05-fixtures.mjs';

const fixture = makeApprovedFixture();
const plan = fixture.plan;
const splitManifest = fixture.manifest;
const prompts = makeBlindPrompts();
const options = { schemas: compileV05Schemas(), corpusRows: fixture.rows };

test('restricted blind suite enforces exact 240-prompt category/language and risk/form quotas', () => {
  const result = validateBlindEvaluation(prompts, splitManifest, plan, options);
  assert.deepEqual(result.errors, []);
  assert.equal(result.counts.prompts, 240);
  assert.equal(result.counts.multiTurn, 100);
  assert.equal(result.counts.highOrCritical, 120);
  assert.deepEqual(result.counts.byLanguage, { en: 120, sw: 120 });
  assert.match(result.inventorySha256, /^[a-f0-9]{64}$/);
});

test('blind suite fails closed on missing cells, duplicate clusters, custody exposure, language claims, and private data', () => {
  const invalid = clone(prompts).slice(1);
  invalid[0].semanticClusterId = invalid[1].semanticClusterId;
  invalid[2].custody.trainingEngineerAccess = true;
  invalid[3].languageAssessment.competence = 'fluent-sw';
  invalid[4].messages[0].content += ' person@example.org';
  const result = validateBlindEvaluation(invalid, splitManifest, plan, options);
  const errors = result.errors.join('\n');
  assert.match(errors, /239\/240/);
  assert.match(errors, /semanticClusterId values must be unique/);
  assert.match(errors, /must be equal to constant/);
  assert.match(errors, /lacks fluent English review/);
  assert.match(errors, /email-address/);
  assert.match(errors, /blind privacy\/en has 11\/12/);
});

test('blind suite rejects verbatim or normalized turn content copied from the frozen corpus', () => {
  const invalid = clone(prompts);
  const corpusUserTurn = fixture.rows[0].messages.find(message => message.role === 'user').content;
  invalid[0].messages[0].content = corpusUserTurn.toUpperCase();
  const errors = validateBlindEvaluation(invalid, splitManifest, plan, options).errors.join('\n');
  assert.match(errors, /reuses normalized turn content from the frozen corpus/);
});
