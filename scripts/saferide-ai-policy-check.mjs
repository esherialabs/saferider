#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const policyPath = path.join(repoRoot, 'config/ai/safe-assistant-policy.json');
const schemaPath = path.join(repoRoot, 'schemas/ai-safe-assistant-policy.schema.json');
const requiredApprovals = new Set(['product-safeguarding', 'technical-ml', 'privacy', 'legal', 'kiswahili']);

export function validatePolicySemantics(policy, { forTraining = false } = {}) {
  const errors = [];
  const triggerSet = new Set(policy.criticalTriggers ?? []);
  for (const trigger of ['hidden-prompt-disclosure', 'successful-policy-extraction', 'jailbreak-success']) {
    if (!triggerSet.has(trigger)) errors.push(`critical trigger ${trigger} is required`);
  }
  if (policy.evaluation?.completeResponsesOnly !== true) errors.push('truncated or incomplete responses must not count as complete');
  if (policy.evaluation?.scoreOneRequiresMitigationAndRetest !== true) errors.push('score-one findings must require mitigation and retest');
  if (policy.evaluation?.maximumCriticalFailures !== 0) errors.push('maximum critical failures must be zero');
  if (policy.privacy?.rawPromptLoggingAllowed !== false || policy.privacy?.rawCompletionLoggingAllowed !== false) {
    errors.push('raw prompt and completion logging must remain forbidden');
  }
  if (policy.privacy?.survivorDataAllowed !== false || policy.privacy?.exactLocationAllowed !== false) {
    errors.push('survivor data and exact location must remain forbidden');
  }
  if (policy.languages?.sheng?.evaluationEnabled || policy.languages?.sheng?.productEnabled || policy.languages?.sheng?.humanReview !== 'absent') {
    errors.push('Sheng must remain absent and disabled until an approved pack exists');
  }
  const approvals = new Map((policy.approvals ?? []).map(approval => [approval.role, approval]));
  for (const role of requiredApprovals) {
    if (!approvals.has(role)) errors.push(`required approval role ${role} is missing`);
  }
  if (policy.status !== 'approved') {
    if (policy.rollout?.maxPercent !== 0 || policy.rollout?.capabilityEnabled !== false) {
      errors.push('unapproved policy requires zero rollout and disabled capability');
    }
  }
  if (forTraining) {
    if (policy.status !== 'approved' || !policy.effectiveDate) errors.push('training requires an approved effective policy');
    for (const role of requiredApprovals) {
      const approval = approvals.get(role);
      if (approval?.status !== 'approved' || !approval.reviewerIdentity || !approval.reviewedAt || !approval.artifactRef) {
        errors.push(`training requires attributable approved ${role} policy review`);
      }
    }
  }
  return errors;
}

function main() {
  const forTraining = process.argv.includes('--for-training');
  const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false, strictTypes: false });
  const validate = ajv.compile(schema);
  const errors = [];
  if (!validate(policy)) {
    for (const error of validate.errors ?? []) errors.push(`${error.instancePath || '/'}: ${error.message}`);
  }
  errors.push(...validatePolicySemantics(policy, { forTraining }));
  console.log(`SafeRide safe-assistant policy check (${forTraining ? 'training gate' : 'structural gate'})`);
  if (errors.length) {
    errors.forEach(error => console.error(`- ${error}`));
    return 1;
  }
  console.log(`PASS (${policy.policyId}; status=${policy.status}; rollout=${policy.rollout.maxPercent}%)`);
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
