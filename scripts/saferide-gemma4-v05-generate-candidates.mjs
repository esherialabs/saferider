#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { normalizeText } from './saferide-gemma4-dataset-audit.mjs';
import {
  DATASET_ID,
  LANGUAGES,
  canonicalSha256,
  compareCandidates,
  compileV05Schemas,
  fileSha256,
  jsonlText,
  privacyFindings,
  readJson,
  readJsonl,
  responseSkeletonId,
  schemaErrors,
  sha256,
  validateMessageRoles,
} from './lib/saferide-gemma4-v05.mjs';
import {
  artifactPath,
  assertPrivateFile,
  atomicWritePrivate,
  enforcePrivateUmask,
  ensurePrivateDirectory,
  secureArtifactRoot,
} from './lib/saferide-artifact-security.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TRANSIENT_REASONS = new Set(['TRANSIENT_TIMEOUT', 'TRANSIENT_RATE_LIMIT', 'PROVIDER_PROCESS_FAILED']);
const PRIVACY = Object.freeze({
  containsPrompts: false,
  containsCompletions: false,
  containsCredentials: false,
  containsRequestResponseBodies: false,
});

function usage() {
  return [
    'Usage: node scripts/saferide-gemma4-v05-generate-candidates.mjs',
    '  --artifact-root <absolute-dir> --authoring-pack <jsonl> --output-dir <path>',
    '  --generator-config <json> [--batch-size <n>] [--candidates-per-job <n>] [--resume]',
    '',
    'The adapter emits restricted candidates plus content-free manifests. It never logs prompts or completions.',
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.some(argument => ['--help', '-h'].includes(argument))) {
    console.log(usage());
    process.exit(0);
  }
  const args = { resume: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--artifact-root') args.artifactRoot = argv[++index];
    else if (argument === '--authoring-pack') args.authoringPack = argv[++index];
    else if (argument === '--output-dir') args.outputDir = argv[++index];
    else if (argument === '--generator-config') args.generatorConfig = argv[++index];
    else if (argument === '--batch-size') args.batchSize = Number(argv[++index]);
    else if (argument === '--candidates-per-job') args.candidatesPerJob = Number(argv[++index]);
    else if (argument === '--resume') args.resume = true;
    else throw new Error(`Unknown or incomplete argument: ${argument}\n\n${usage()}`);
  }
  for (const field of ['artifactRoot', 'authoringPack', 'outputDir', 'generatorConfig']) {
    if (!args[field]) throw new Error(`--${field.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)} is required`);
  }
  return args;
}

function safeReason(error) {
  if (error && typeof error === 'object' && typeof error.reasonCode === 'string') return error.reasonCode;
  return 'PROVIDER_PROCESS_FAILED';
}

function providerFailure(reasonCode) {
  const error = new Error(reasonCode);
  error.reasonCode = reasonCode;
  return error;
}

function candidateOrdinalWord(language, ordinal) {
  if (language === 'sw') return ['kwanza', 'pili', 'tatu'][ordinal - 1];
  return ['first', 'second', 'third'][ordinal - 1];
}

function mockMessages(job, ordinal) {
  const category = job.scenario.primaryCategory.toLowerCase();
  const ordinalWord = candidateOrdinalWord(job.language, ordinal);
  if (job.language === 'sw') {
    const user = turn => ({
      role: 'user',
      content: turn === 1
        ? `Hii ni hali ya kubuni ya ${category} na ninaomba mwongozo huru wa ${ordinalWord} kuhusu hatua salama.`
        : 'Naomba uhakikishe bila kuongeza taarifa ambayo haijathibitishwa au kuniondolea chaguo langu.',
    });
    const assistant = turn => ({
      role: 'assistant',
      content: turn === 1
        ? 'Unaweza kuanza kwa kutenganisha hali inayoonekana na jambo ambalo halijathibitishwa. Siwezi kuthibitisha taarifa iliyofichwa. Ukiwa salama, chagua hatua ndogo inayolinda faragha, uhuru wako, na ukweli unaojulikana.'
        : 'Ikiwa hali bado haijathibitishwa, endelea kuiweka wazi kama haijulikani. Unaweza kuhifadhi maelezo yanayoonekana, kuepuka madai mapya, na kutafuta msaada wa mtu mwenye sifa inapofaa na salama.',
    });
    return job.conversationForm === 'single-turn'
      ? [user(1), assistant(1)]
      : [user(1), assistant(1), user(2), assistant(2)];
  }
  const user = turn => ({
    role: 'user',
    content: turn === 1
      ? `This is a synthetic ${category} situation, and I want the ${ordinalWord} independently authored safe option.`
      : 'Please be definite even if the available information does not confirm the state or the next external action.',
  });
  const assistant = turn => ({
    role: 'assistant',
    content: turn === 1
      ? 'You can separate what is visibly known from what remains unconfirmed. I cannot confirm hidden information. If it is safe, choose one small next step that protects privacy, keeps your options open, and does not add facts.'
      : 'If the state is still unconfirmed, keep that uncertainty explicit. You can preserve the visible details, avoid a new claim, and consider qualified local support when that is appropriate, available, and safe for you.',
  });
  return job.conversationForm === 'single-turn'
    ? [user(1), assistant(1)]
    : [user(1), assistant(1), user(2), assistant(2)];
}

function mockOutcome(config, job, ordinal, attempt) {
  const entry = (config.mock?.failurePlan ?? []).find(item => item.jobId === job.jobId && item.ordinal === ordinal);
  if (!entry) return 'success';
  return entry.outcomes[Math.min(attempt - 1, entry.outcomes.length - 1)];
}

function builtInMockProvider({ config, job, ordinal, attempt }) {
  const outcome = mockOutcome(config, job, ordinal, attempt);
  if (outcome === 'transient-timeout') throw providerFailure('TRANSIENT_TIMEOUT');
  if (outcome === 'transient-rate-limit') throw providerFailure('TRANSIENT_RATE_LIMIT');
  if (outcome === 'deterministic-rejection') throw providerFailure('DETERMINISTIC_PROVIDER_REJECTION');
  if (outcome === 'malformed-output') return { messages: [{ role: 'system', content: 'invalid fixture result' }] };
  return { messages: mockMessages(job, ordinal) };
}

function providerEnvironment(provider) {
  const environment = {};
  for (const name of ['PATH', ...provider.allowedEnvironmentVariables]) {
    if (typeof process.env[name] === 'string') environment[name] = process.env[name];
  }
  if (provider.credentialEnvironmentVariable) {
    const value = process.env[provider.credentialEnvironmentVariable];
    if (!value) throw providerFailure('PROVIDER_PROCESS_FAILED');
    environment[provider.credentialEnvironmentVariable] = value;
  }
  return environment;
}

function stdioProvider({ config, job, ordinal }) {
  const provider = config.provider;
  if (!provider.executablePath || !fs.existsSync(provider.executablePath) || !fs.statSync(provider.executablePath).isFile()) {
    throw providerFailure('PROVIDER_PROCESS_FAILED');
  }
  if (fileSha256(provider.executablePath) !== provider.executableSha256) throw providerFailure('PROVIDER_PROCESS_FAILED');
  const request = {
    protocol: 'com.saferide.ai.v05-generation-request',
    schemaVersion: 1,
    requestId: sha256(`${config.runId}:${job.jobId}:${ordinal}`).slice(0, 32),
    language: job.language,
    independentlyAuthoredFromSharedScenario: true,
    candidateOrdinal: ordinal,
    conversationForm: job.conversationForm,
    scenario: job.scenario,
    constraints: {
      systemMessageAllowed: false,
      syntheticOnly: true,
      maximumOutputTokens: config.generation.maxOutputTokens,
      authoringPromptId: config.authoring.authoringPromptId,
      authoringPromptSha256: config.authoring.authoringPromptSha256,
      policySha256: config.authoring.policySha256,
      systemPromptConfigSha256: config.authoring.systemPromptConfigSha256,
    },
  };
  const result = spawnSync(provider.executablePath, provider.arguments, {
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    env: providerEnvironment(provider),
    timeout: provider.timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  if (result.error?.code === 'ETIMEDOUT') throw providerFailure('TRANSIENT_TIMEOUT');
  if (result.error || result.status !== 0) throw providerFailure('PROVIDER_PROCESS_FAILED');
  let response;
  try {
    response = JSON.parse(result.stdout);
  } catch {
    throw providerFailure('MALFORMED_PROVIDER_OUTPUT');
  }
  if (response.status === 'error') {
    if (response.errorClass === 'transient' && response.reasonCode === 'RATE_LIMIT') throw providerFailure('TRANSIENT_RATE_LIMIT');
    if (response.errorClass === 'transient') throw providerFailure('PROVIDER_PROCESS_FAILED');
    throw providerFailure('DETERMINISTIC_PROVIDER_REJECTION');
  }
  return { messages: response.messages };
}

function runProvider(input, providerOverride) {
  if (providerOverride) return providerOverride(input);
  return input.config.provider.protocol === 'mock-v1' ? builtInMockProvider(input) : stdioProvider(input);
}

export function contentBoundCandidateId(rowId, ordinal, configurationSha256, messages) {
  const digest = canonicalSha256({ rowId, ordinal, configurationSha256, messages });
  return `cand-${rowId.toLowerCase()}-${ordinal}-${digest.slice(0, 16)}`;
}

function candidateFromProvider({ config, configurationSha256, job, ordinal, response, schemas }) {
  const messages = response?.messages;
  if (!Array.isArray(messages)) throw providerFailure('MALFORMED_PROVIDER_OUTPUT');
  const candidateId = contentBoundCandidateId(job.rowId, ordinal, configurationSha256, messages);
  const candidate = {
    schema: 'com.saferide.ai.training-example',
    schemaVersion: 1,
    stage: 'candidate',
    id: job.rowId,
    candidateId,
    datasetId: DATASET_ID,
    split: job.split,
    messages,
    metadata: {
      language: job.language,
      primaryCategory: job.scenario.primaryCategory,
      secondaryTags: job.scenario.secondaryTags,
      scenarioFamilyId: job.scenarioFamilyId,
      semanticClusterId: job.scenario.semanticClusterId,
      conversationForm: job.conversationForm,
      riskLevel: job.scenario.riskLevel,
      userGoalCode: `goal-${sha256(normalizeText(job.scenario.userGoal)).slice(0, 20)}`,
      appState: job.scenario.appState,
      responseStrategy: job.scenario.responseStrategy,
      responseSkeletonId: responseSkeletonId(messages),
      sourceKind: 'repository-authored-synthetic',
      sourcePolicyRefs: job.scenario.policyRefs,
      generatorVersion: config.configId,
      reviewStatus: 'unreviewed',
      prohibitedDataScreen: 'pending',
      longResponseReason: null,
    },
    authoring: {
      method: config.authoring.method,
      toolId: config.authoring.toolId,
      toolRevision: config.authoring.toolRevision,
      configurationSha256,
      authoringPromptSha256: config.authoring.authoringPromptSha256,
      scenarioFamilyId: job.scenarioFamilyId,
      createdAt: config.runCreatedAt,
      authorIdentityRef: config.authoring.authorIdentityRef,
      termsAssessmentRef: config.authoring.termsAssessmentRef,
      syntheticOnlyAttested: true,
      status: 'unreviewed',
    },
  };
  const errors = [
    ...schemaErrors('candidate', schemas.example, candidate),
    ...validateMessageRoles(candidate),
    ...privacyFindings(candidate.messages, 'candidate.messages').map(finding => `${finding.location}:${finding.code}`),
  ];
  if (candidate.authoring.configurationSha256 !== configurationSha256) errors.push('candidate configuration hash is stale');
  if (candidate.candidateId !== contentBoundCandidateId(job.rowId, ordinal, configurationSha256, messages)) errors.push('candidate ID is not content-bound');
  if (errors.length) throw providerFailure('CANDIDATE_SCHEMA_REJECTION');
  return candidate;
}

export function validateGeneratorConfiguration(config, schemas = compileV05Schemas()) {
  const errors = schemaErrors('generatorConfig', schemas.generatorConfig, config);
  const ordinals = config.generation?.candidateOrdinals ?? [];
  if (ordinals.some((value, index) => index > 0 && value <= ordinals[index - 1])) errors.push('candidate ordinals must be in ascending order');
  if (config.status === 'test-only' && !config.runId.startsWith('test-') && !config.runId.startsWith('smoke-')) errors.push('test-only generator runId must use a test- or smoke- prefix');
  if (config.status === 'approved-controlled') {
    if (config.mock) errors.push('approved-controlled generator configuration may not include mock behavior');
    if (!config.approval?.configurationOwnerRef || !config.approval?.approvalEvidenceRef) errors.push('approved-controlled configuration lacks attributable approval references');
    if (config.provider?.remote && config.approval?.remoteGenerationApproved !== true) errors.push('remote generation is not approved');
  }
  if (config.provider?.protocol === 'stdio-json-v1' && config.provider.executablePath) {
    if (!path.isAbsolute(config.provider.executablePath)) errors.push('provider executablePath must be absolute');
    else if (fs.existsSync(config.provider.executablePath) && fileSha256(config.provider.executablePath) !== config.provider.executableSha256) errors.push('provider executable hash is stale');
  }
  const privateConfigFindings = privacyFindings(config, 'generatorConfig')
    .filter(finding => !['url'].includes(finding.code));
  if (privateConfigFindings.length) errors.push('generator configuration contains a secret or private-data pattern');
  return errors;
}

export function validateAuthoringPack(jobs, config, schemas = compileV05Schemas()) {
  const errors = [];
  jobs.forEach((job, index) => {
    errors.push(...schemaErrors(`authoringJob[${index}]`, schemas.authoringJob, job));
    errors.push(...schemaErrors(`authoringJob[${index}].scenario`, schemas.scenario, job.scenario));
    if (job.jobId !== `author:${job.rowId}`) errors.push(`authoringJob[${index}] jobId does not match rowId`);
    if (job.scenarioFamilyId !== job.scenario?.scenarioFamilyId) errors.push(`authoringJob[${index}] family binding differs`);
    if (job.scenarioSpecSha256 !== canonicalSha256(job.scenario)) errors.push(`authoringJob[${index}] scenario hash is stale`);
    if (!job.rowId.endsWith(`-${job.language}`)) errors.push(`authoringJob[${index}] language differs from rowId`);
    if (job.contentLoggingAllowed !== false || job.maximumCandidates !== 3) errors.push(`authoringJob[${index}] weakens content or candidate limits`);
  });
  if (new Set(jobs.map(job => job.jobId)).size !== jobs.length) errors.push('authoring job IDs must be unique');
  if (new Set(jobs.map(job => job.rowId)).size !== jobs.length) errors.push('authoring row IDs must be unique');
  if (config.scope?.mode === 'all' && config.status === 'approved-controlled' && jobs.length !== 2600) errors.push('approved full generation requires exactly 2600 authoring jobs');
  if (config.status === 'approved-controlled') {
    const unapproved = jobs.filter(job => job.scenario?.matrixReview?.status !== 'approved' || !job.scenario?.matrixReview?.evidenceRef);
    if (unapproved.length) errors.push('approved-controlled generation requires an externally approved frozen scenario matrix');
  }
  const jobsById = new Map(jobs.map(job => [job.jobId, job]));
  if (config.scope?.mode === 'explicit') {
    for (const jobId of config.scope.jobIds ?? []) if (!jobsById.has(jobId)) errors.push('generator scope names an unknown authoring job');
  }
  if (jobs.length === 2600) {
    for (const language of LANGUAGES) {
      if (jobs.filter(job => job.language === language).length !== 1300) errors.push(`authoring pack must contain 1300 ${language} jobs`);
    }
  }
  return errors;
}

function selectedJobs(jobs, config) {
  if (config.scope.mode === 'all') return [...jobs];
  const selected = new Set(config.scope.jobIds);
  return jobs.filter(job => selected.has(job.jobId));
}

function relativeToRoot(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

function loadBatchState(root, authoringPackSha256, schemas) {
  const incoming = artifactPath(root, 'candidates/incoming', { classification: 'restricted' });
  if (!fs.existsSync(incoming)) return { batches: [], candidates: [], slots: new Map(), maxBatchNumber: 0 };
  const manifestNames = fs.readdirSync(incoming).filter(name => name.endsWith('.manifest.json')).sort();
  const referencedCandidateFiles = new Set();
  const batches = [];
  const candidates = [];
  const slots = new Map();
  let maxBatchNumber = 0;
  for (const name of manifestNames) {
    const manifestPath = assertPrivateFile(path.join(incoming, name), root);
    const manifest = readJson(manifestPath);
    const manifestErrors = schemaErrors(`generationBatch ${name}`, schemas.generationBatch, manifest);
    if (manifestErrors.length) throw new Error(`Existing generation manifest is invalid (${manifestErrors.length} findings)`);
    if (manifest.authoringPackSha256 !== authoringPackSha256) throw new Error('Existing generation manifest belongs to a different authoring pack');
    const candidatePath = assertPrivateFile(artifactPath(root, manifest.candidateFile.path), root);
    referencedCandidateFiles.add(path.basename(candidatePath));
    if (fileSha256(candidatePath) !== manifest.candidateFile.sha256 || fs.statSync(candidatePath).size !== manifest.candidateFile.sizeBytes) {
      throw new Error('Existing candidate batch hash or byte size is stale');
    }
    const batchCandidates = readJsonl(candidatePath);
    if (batchCandidates.length !== manifest.candidateFile.candidateCount) throw new Error('Existing candidate batch count is stale');
    if (manifest.completedSlots.length !== batchCandidates.length) throw new Error('Existing candidate batch slot inventory is incomplete');
    const candidateById = new Map(batchCandidates.map(candidate => [candidate.candidateId, candidate]));
    if (candidateById.size !== batchCandidates.length) throw new Error('Existing candidate batch repeats a candidate ID');
    const completedCandidateIds = new Set(manifest.completedSlots.map(slot => slot.candidateId));
    if (completedCandidateIds.size !== manifest.completedSlots.length
      || [...candidateById.keys()].some(candidateId => !completedCandidateIds.has(candidateId))) {
      throw new Error('Existing completed-slot inventory does not exactly cover the candidate file');
    }
    for (const completed of manifest.completedSlots) {
      const candidate = candidateById.get(completed.candidateId);
      if (!candidate || canonicalSha256(candidate.messages) !== completed.candidateContentSha256) throw new Error('Existing completed-slot content binding is stale');
      if (candidate.candidateId !== contentBoundCandidateId(candidate.id, completed.ordinal, manifest.configurationSha256, candidate.messages)) {
        throw new Error('Existing candidate ID is not bound to its content and configuration');
      }
      const key = `${completed.jobId}:${completed.ordinal}`;
      if (slots.has(key)) throw new Error('Existing generation batches repeat a job/ordinal slot');
      slots.set(key, { ...completed, candidate });
    }
    candidates.push(...batchCandidates);
    const match = manifest.batchId.match(/batch-([0-9]{4})-/);
    maxBatchNumber = Math.max(maxBatchNumber, Number(match?.[1] ?? 0));
    batches.push({ manifest, manifestPath, candidatePath });
  }
  const orphaned = fs.readdirSync(incoming)
    .filter(name => name.endsWith('.jsonl') && !referencedCandidateFiles.has(name));
  if (orphaned.length) throw new Error('Candidate input directory contains an orphaned batch without a completed manifest');
  const candidateIds = candidates.map(candidate => candidate.candidateId);
  if (new Set(candidateIds).size !== candidateIds.length) throw new Error('Existing generation batches repeat candidate IDs');
  const candidatesByJob = new Map();
  for (const slot of slots.values()) {
    const entries = candidatesByJob.get(slot.jobId) ?? [];
    entries.push(slot);
    candidatesByJob.set(slot.jobId, entries);
  }
  if ([...candidatesByJob.values()].some(entries => entries.length > 3)) throw new Error('Existing generation state exceeds three candidates for a family-language slot');
  return { batches, candidates, slots, maxBatchNumber };
}

function runOne({ config, configurationSha256, job, ordinal, schemas, providerOverride }) {
  const retryCounts = {};
  let attempts = 0;
  while (attempts <= config.generation.maximumRetries) {
    attempts += 1;
    try {
      const response = runProvider({ config, job, ordinal, attempt: attempts }, providerOverride);
      const candidate = candidateFromProvider({ config, configurationSha256, job, ordinal, response, schemas });
      return { candidate, attempts, retryCounts };
    } catch (error) {
      const reasonCode = safeReason(error);
      const transient = TRANSIENT_REASONS.has(reasonCode);
      if (transient && attempts <= config.generation.maximumRetries) {
        retryCounts[reasonCode] = (retryCounts[reasonCode] ?? 0) + 1;
        continue;
      }
      return { failure: { jobId: job.jobId, ordinal, reasonCode, attempts }, retryCounts };
    }
  }
  throw new Error('Unreachable retry state');
}

function buildIndex(root, state, authoringPackSha256, selected, requestedOrdinals, schemas) {
  const batchEntries = state.batches.map(({ manifest, manifestPath }) => ({
    batchId: manifest.batchId,
    manifestPath: relativeToRoot(root, manifestPath),
    manifestSha256: fileSha256(manifestPath),
    candidateFilePath: manifest.candidateFile.path,
    candidateFileSha256: manifest.candidateFile.sha256,
    candidateCount: manifest.candidateFile.candidateCount,
    failureCount: manifest.failures.length,
  })).sort((left, right) => left.batchId.localeCompare(right.batchId));
  const selectedKeys = selected.flatMap(job => requestedOrdinals.map(ordinal => `${job.jobId}:${ordinal}`));
  const missing = selectedKeys.filter(key => !state.slots.has(key));
  const failedAttemptCount = state.batches.reduce((total, batch) => total + batch.manifest.failures.length, 0);
  const inventory = state.candidates.map(candidate => ({
    candidateId: candidate.candidateId,
    contentSha256: canonicalSha256(candidate.messages),
  })).sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const index = {
    schema: 'com.saferide.ai.v05-candidate-generation-index',
    schemaVersion: 1,
    datasetId: DATASET_ID,
    classification: 'controlled-content-free',
    authoringPackSha256,
    batchCount: batchEntries.length,
    candidateCount: state.candidates.length,
    coveredSlotCount: new Set([...state.slots.values()].map(slot => slot.jobId)).size,
    failedAttemptCount,
    maximumCandidatesPerSlot: 3,
    batches: batchEntries,
    candidateInventorySha256: canonicalSha256(inventory),
    status: missing.length === 0 ? 'complete' : failedAttemptCount ? 'partial-with-failures' : 'partial-coverage',
    privacy: { ...PRIVACY },
  };
  const errors = schemaErrors('generationIndex', schemas.generationIndex, index);
  if (errors.length) throw new Error(`Generated candidate index failed (${errors.length} findings)`);
  atomicWritePrivate(artifactPath(root, 'candidates/candidate-index.json', { classification: 'controlled' }), `${JSON.stringify(index, null, 2)}\n`, {
    rootPath: root,
    overwrite: true,
  });
  return index;
}

export function generateCandidateBatches({
  root,
  jobs,
  config,
  configurationSha256,
  authoringPackSha256,
  outputDir,
  resume = false,
  providerOverride = null,
  clock = () => new Date().toISOString(),
  schemas = compileV05Schemas(),
}) {
  const configErrors = validateGeneratorConfiguration(config, schemas);
  const jobErrors = validateAuthoringPack(jobs, config, schemas);
  if (config.bindings?.authoringPackSha256 !== authoringPackSha256) configErrors.push('generator configuration authoring-pack hash is stale');
  if (configErrors.length || jobErrors.length) throw new Error(`Candidate generation inputs failed (${configErrors.length + jobErrors.length} findings)`);
  const expectedOutput = artifactPath(root, 'candidates/incoming', { classification: 'restricted' });
  if (path.resolve(outputDir) !== expectedOutput) throw new Error('Candidate generation output-dir must be candidates/incoming under the artifact root');
  ensurePrivateDirectory(expectedOutput, root);
  let state = loadBatchState(root, authoringPackSha256, schemas);
  if (state.batches.length && !resume) throw new Error('Existing candidate batches require --resume');
  const selected = selectedJobs(jobs, config).sort((left, right) => left.jobId.localeCompare(right.jobId));
  const tasksByJob = selected.map(job => ({
    job,
    ordinals: config.generation.candidateOrdinals.filter(ordinal => !state.slots.has(`${job.jobId}:${ordinal}`)),
  })).filter(entry => entry.ordinals.length);
  let nextBatchNumber = state.maxBatchNumber + 1;
  for (let offset = 0; offset < tasksByJob.length; offset += config.generation.batchSize) {
    const batchTasks = tasksByJob.slice(offset, offset + config.generation.batchSize);
    const batchNumber = nextBatchNumber++;
    const suffix = configurationSha256.slice(0, 8);
    const batchId = `v05-generation-batch-${String(batchNumber).padStart(4, '0')}-${suffix}`;
    const startedAt = config.status === 'test-only' ? config.runCreatedAt : clock();
    const candidates = [];
    const failures = [];
    const retryCountsByReason = {};
    for (const { job, ordinals } of batchTasks) {
      for (const ordinal of ordinals) {
        const result = runOne({ config, configurationSha256, job, ordinal, schemas, providerOverride });
        for (const [reason, count] of Object.entries(result.retryCounts)) retryCountsByReason[reason] = (retryCountsByReason[reason] ?? 0) + count;
        if (result.candidate) candidates.push({ jobId: job.jobId, ordinal, candidate: result.candidate });
        else failures.push(result.failure);
      }
    }
    candidates.sort((left, right) => compareCandidates(left.candidate, right.candidate));
    failures.sort((left, right) => left.jobId.localeCompare(right.jobId) || left.ordinal - right.ordinal);
    const candidateRows = candidates.map(entry => entry.candidate);
    const candidateRelative = `candidates/incoming/${batchId}.jsonl`;
    const candidateWrite = atomicWritePrivate(artifactPath(root, candidateRelative, { classification: 'restricted' }), jsonlText(candidateRows), { rootPath: root });
    const completedAt = config.status === 'test-only' ? config.runCreatedAt : clock();
    const requested = batchTasks.reduce((total, entry) => total + entry.ordinals.length, 0);
    const manifest = {
      schema: 'com.saferide.ai.v05-candidate-generation-batch',
      schemaVersion: 1,
      batchId,
      datasetId: DATASET_ID,
      classification: 'controlled-content-free',
      runId: config.runId,
      sourceCommit: config.sourceCommit,
      configurationSha256,
      authoringPackSha256,
      orderedJobIds: batchTasks.map(entry => entry.job.jobId),
      candidateOrdinals: [...config.generation.candidateOrdinals],
      startedAt,
      completedAt,
      counts: {
        requested,
        completed: candidates.length,
        deterministicRejected: failures.filter(failure => !TRANSIENT_REASONS.has(failure.reasonCode)).length,
        transportFailed: failures.filter(failure => TRANSIENT_REASONS.has(failure.reasonCode)).length,
      },
      retryCountsByReason,
      candidateFile: {
        path: candidateRelative,
        sha256: candidateWrite.sha256,
        sizeBytes: candidateWrite.sizeBytes,
        candidateCount: candidates.length,
      },
      completedSlots: candidates.map(entry => ({
        jobId: entry.jobId,
        ordinal: entry.ordinal,
        candidateId: entry.candidate.candidateId,
        candidateContentSha256: canonicalSha256(entry.candidate.messages),
      })),
      failures,
      privacy: { ...PRIVACY },
    };
    const manifestErrors = schemaErrors('generationBatch', schemas.generationBatch, manifest);
    if (manifestErrors.length) throw new Error(`Generated batch manifest failed (${manifestErrors.length} findings)`);
    atomicWritePrivate(artifactPath(root, `candidates/incoming/${batchId}.manifest.json`, { classification: 'controlled' }), `${JSON.stringify(manifest, null, 2)}\n`, { rootPath: root });
  }
  state = loadBatchState(root, authoringPackSha256, schemas);
  return buildIndex(root, state, authoringPackSha256, selected, config.generation.candidateOrdinals, schemas);
}

function main() {
  enforcePrivateUmask();
  const args = parseArgs(process.argv.slice(2));
  const root = secureArtifactRoot(args.artifactRoot, { create: false });
  const authoringPackPath = assertPrivateFile(artifactPath(root, args.authoringPack), root);
  const configPath = assertPrivateFile(artifactPath(root, args.generatorConfig), root);
  const outputDir = artifactPath(root, args.outputDir, { classification: 'restricted' });
  const config = readJson(configPath);
  if (args.batchSize !== undefined && args.batchSize !== config.generation?.batchSize) throw new Error('--batch-size must match the immutable generator configuration');
  if (args.candidatesPerJob !== undefined && args.candidatesPerJob !== config.generation?.candidateOrdinals?.length) {
    throw new Error('--candidates-per-job must match the immutable generator configuration');
  }
  const jobs = readJsonl(authoringPackPath);
  const index = generateCandidateBatches({
    root,
    jobs,
    config,
    configurationSha256: fileSha256(configPath),
    authoringPackSha256: fileSha256(authoringPackPath),
    outputDir,
    resume: args.resume,
  });
  console.log(`Candidate generation ${index.status === 'complete' ? 'COMPLETE' : 'BLOCKED'} (${index.candidateCount} candidates; ${index.coveredSlotCount} covered slots; ${index.failedAttemptCount} failed attempts).`);
  console.log(`Candidate inventory SHA-256: ${index.candidateInventorySha256}`);
  if (index.status !== 'complete') return 1;
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
