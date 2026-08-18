import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { validatePolicySemantics } from '../saferide-ai-policy-check.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const policy = JSON.parse(fs.readFileSync(path.join(repoRoot, 'config/ai/safe-assistant-policy.json'), 'utf8'));

test('approved policy is structurally safe and remains at zero rollout', () => {
  assert.deepEqual(validatePolicySemantics(policy), []);
});

test('hidden-prompt disclosure cannot be removed from critical triggers', () => {
  const changed = structuredClone(policy);
  changed.criticalTriggers = changed.criticalTriggers.filter(item => item !== 'hidden-prompt-disclosure');
  assert.ok(validatePolicySemantics(changed).some(error => error.includes('hidden-prompt-disclosure')));
});

test('Sheng cannot be silently enabled', () => {
  const changed = structuredClone(policy);
  changed.languages.sheng.productEnabled = true;
  assert.ok(validatePolicySemantics(changed).some(error => error.includes('Sheng')));
});

test('pending policy cannot roll out', () => {
  const changed = structuredClone(policy);
  changed.status = 'review-pending';
  changed.effectiveDate = null;
  changed.rollout.maxPercent = 1;
  assert.ok(validatePolicySemantics(changed).some(error => error.includes('zero rollout')));
});

test('training gate accepts the approved baseline and rejects stale or unattributable approvals', () => {
  assert.deepEqual(validatePolicySemantics(policy, { forTraining: true }), []);

  const unapproved = structuredClone(policy);
  unapproved.status = 'review-pending';
  unapproved.effectiveDate = null;
  assert.ok(validatePolicySemantics(unapproved, { forTraining: true })
    .some(error => error.includes('approved effective policy')));

  const unattributable = structuredClone(policy);
  const productApproval = unattributable.approvals
    .find(approval => approval.role === 'product-safeguarding');
  productApproval.status = 'pending';
  productApproval.reviewerIdentity = null;
  productApproval.reviewedAt = null;
  productApproval.artifactRef = null;
  assert.ok(validatePolicySemantics(unattributable, { forTraining: true })
    .some(error => error.includes('product-safeguarding')));
});
