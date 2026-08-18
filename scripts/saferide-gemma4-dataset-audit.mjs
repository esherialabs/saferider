#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditScriptPath = fileURLToPath(import.meta.url);
const defaults = {
  data: 'data/ai/gemma4/saferide-synthetic-guidance-v0.4.jsonl',
  register: 'docs/security/saferide-gemma4-colab-input-register.synthetic-v0.4.candidate.json',
  report: 'docs/security/saferide-gemma4-v04-dataset-audit.json',
};

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function normalizeText(value) {
  return String(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(value) {
  return normalizeText(value).split(' ').filter(Boolean);
}

function ngrams(tokens, size) {
  const result = new Set();
  for (let index = 0; index <= tokens.length - size; index += 1) {
    result.add(tokens.slice(index, index + size).join(' '));
  }
  return result;
}

function jaccard(left, right) {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  return intersection / Math.max(1, left.size + right.size - intersection);
}

function termFrequency(tokens) {
  const frequencies = new Map();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return frequencies;
}

function cosine(left, right) {
  let dot = 0;
  let leftSquare = 0;
  let rightSquare = 0;
  for (const value of left.values()) leftSquare += value * value;
  for (const value of right.values()) rightSquare += value * value;
  for (const [token, value] of left.entries()) dot += value * (right.get(token) ?? 0);
  if (leftSquare === 0 || rightSquare === 0) return 0;
  return dot / (Math.sqrt(leftSquare) * Math.sqrt(rightSquare));
}

function percentile(values, fraction) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function parseJsonl(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid JSONL at line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

function turnDocuments(rows) {
  return rows.flatMap(row => row.messages.flatMap((message, turnIndex) => {
    if (!['user', 'assistant'].includes(message.role)) return [];
    const tokens = words(message.content);
    return [{
      rowId: row.id,
      split: row.split,
      role: message.role,
      turnIndex,
      exactHash: sha256(String(message.content)),
      normalizedHash: sha256(normalizeText(message.content)),
      tokens,
      trigrams: ngrams(tokens, 3),
      termFrequency: termFrequency(tokens),
      deterministicRegressionFixture: row.metadata?.deterministicRegressionFixture === true,
    }];
  }));
}

function conversationDocuments(rows) {
  return rows.map(row => ({
    rowId: row.id,
    split: row.split,
    exactHash: sha256(JSON.stringify(row.messages)),
    normalizedHash: sha256(row.messages.map(message => `${message.role}:${normalizeText(message.content)}`).join('\n')),
  }));
}

function crossSplitCollisions(documents, hashField) {
  const byHash = new Map();
  for (const document of documents) {
    const entries = byHash.get(document[hashField]) ?? [];
    entries.push(document);
    byHash.set(document[hashField], entries);
  }
  return [...byHash.entries()].flatMap(([hash, entries]) => {
    const splits = [...new Set(entries.map(entry => entry.split))].sort();
    if (splits.length < 2) return [];
    return [{
      hash,
      splits,
      rows: [...new Set(entries.map(entry => entry.rowId))].sort(),
      role: entries[0].role ?? 'conversation',
    }];
  });
}

function compareAcrossSplits(documents, policy) {
  const nearDuplicates = [];
  const assistantCopies = [];
  for (let leftIndex = 0; leftIndex < documents.length; leftIndex += 1) {
    const left = documents[leftIndex];
    for (let rightIndex = leftIndex + 1; rightIndex < documents.length; rightIndex += 1) {
      const right = documents[rightIndex];
      if (left.split === right.split || left.role !== right.role) continue;
      const ngramSimilarity = jaccard(left.trigrams, right.trigrams);
      const semanticProxySimilarity = cosine(left.termFrequency, right.termFrequency);
      if (
        ngramSimilarity >= policy.ngramSimilarityThreshold
        || semanticProxySimilarity >= policy.semanticProxySimilarityThreshold
      ) {
        nearDuplicates.push({
          leftRowId: left.rowId,
          leftSplit: left.split,
          rightRowId: right.rowId,
          rightSplit: right.split,
          role: left.role,
          ngramSimilarity: Number(ngramSimilarity.toFixed(6)),
          semanticProxySimilarity: Number(semanticProxySimilarity.toFixed(6)),
        });
      }
      const training = left.split === 'train' ? left : right.split === 'train' ? right : null;
      const candidate = ['quality-holdout', 'safety-holdout'].includes(left.split)
        ? left
        : ['quality-holdout', 'safety-holdout'].includes(right.split) ? right : null;
      if (
        training
        && candidate
        && candidate.role === 'assistant'
        && !candidate.deterministicRegressionFixture
        && ngramSimilarity >= policy.assistantCopySimilarityThreshold
      ) {
        assistantCopies.push({
          trainRowId: training.rowId,
          candidateRowId: candidate.rowId,
          candidateSplit: candidate.split,
          ngramSimilarity: Number(ngramSimilarity.toFixed(6)),
        });
      }
    }
  }
  return { nearDuplicates, assistantCopies };
}

function distinctMetric(documents, size) {
  let total = 0;
  const unique = new Set();
  for (const document of documents) {
    const rowNgrams = [];
    for (let index = 0; index <= document.tokens.length - size; index += 1) {
      rowNgrams.push(document.tokens.slice(index, index + size).join(' '));
    }
    total += rowNgrams.length;
    rowNgrams.forEach(value => unique.add(value));
  }
  return total === 0 ? 0 : unique.size / total;
}

function diversityMetrics(assistantDocuments) {
  const normalizedTargets = assistantDocuments.map(document => document.normalizedHash);
  const openingCounts = new Map();
  for (const document of assistantDocuments) {
    const opening = document.tokens.slice(0, 4).join(' ');
    openingCounts.set(opening, (openingCounts.get(opening) ?? 0) + 1);
  }
  const topRepeatedOpenings = [...openingCounts.entries()]
    .filter(([, count]) => count > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 10)
    .map(([opening, count]) => ({ openingHash: sha256(opening), count }));
  const lengths = assistantDocuments.map(document => document.tokens.length);
  const highestOpeningCount = Math.max(0, ...openingCounts.values());
  return {
    assistantTurnCount: assistantDocuments.length,
    uniqueAssistantTargetCount: new Set(normalizedTargets).size,
    uniqueAssistantTargetRatio: new Set(normalizedTargets).size / Math.max(1, normalizedTargets.length),
    distinct1: distinctMetric(assistantDocuments, 1),
    distinct2: distinctMetric(assistantDocuments, 2),
    distinct3: distinctMetric(assistantDocuments, 3),
    repeatedOpeningCount: [...openingCounts.values()].filter(count => count > 1).length,
    highestRepeatedOpeningShare: highestOpeningCount / Math.max(1, assistantDocuments.length),
    topRepeatedOpenings,
    responseLengthWords: {
      min: Math.min(...lengths),
      p50: percentile(lengths, 0.5),
      p95: percentile(lengths, 0.95),
      max: Math.max(...lengths),
    },
  };
}

function familyIsolation(rows, field) {
  const familySplits = new Map();
  for (const row of rows) {
    const family = row.metadata?.[field];
    const set = familySplits.get(family) ?? new Set();
    set.add(row.split);
    familySplits.set(family, set);
  }
  const violations = [...familySplits.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([family, values]) => ({ family, splits: [...values].sort() }));
  return { count: familySplits.size, violations };
}

function validateProtectedSplits(register) {
  const expected = new Set(['quality-holdout', 'safety-holdout']);
  const configured = new Set(register.protectedSplits?.splits ?? []);
  return (
    [...expected].every(split => configured.has(split))
    && register.protectedSplits?.trainingAllowed === false
    && register.protectedSplits?.routinePromptIterationAllowed === false
  );
}

export function auditDataset({ rows, register, dataSha256, registerSha256 }) {
  const policy = register.auditPolicy;
  if (!policy) throw new Error('Register auditPolicy is required');
  const turns = turnDocuments(rows);
  const conversations = conversationDocuments(rows);
  const exactTurn = crossSplitCollisions(turns, 'exactHash');
  const normalizedTurn = crossSplitCollisions(turns, 'normalizedHash');
  const exactConversation = crossSplitCollisions(conversations, 'exactHash');
  const normalizedConversation = crossSplitCollisions(conversations, 'normalizedHash');
  const similarity = compareAcrossSplits(turns, policy);
  const assistants = turns.filter(document => document.role === 'assistant');
  const diversity = diversityMetrics(assistants);
  const scenarioFamilies = familyIsolation(rows, 'scenarioFamily');
  const templateFamilies = familyIsolation(rows, 'templateFamily');
  const failures = [];

  if (exactTurn.length > policy.exactCrossSplitMax) failures.push(`exact turn overlap ${exactTurn.length} exceeds ${policy.exactCrossSplitMax}`);
  if (normalizedTurn.length > policy.normalizedCrossSplitMax) failures.push(`normalized turn overlap ${normalizedTurn.length} exceeds ${policy.normalizedCrossSplitMax}`);
  if (exactConversation.length > policy.exactCrossSplitMax) failures.push(`exact conversation overlap ${exactConversation.length} exceeds ${policy.exactCrossSplitMax}`);
  if (normalizedConversation.length > policy.normalizedCrossSplitMax) failures.push(`normalized conversation overlap ${normalizedConversation.length} exceeds ${policy.normalizedCrossSplitMax}`);
  if (similarity.nearDuplicates.length > policy.maxNearDuplicatePairs) failures.push(`near-duplicate pairs ${similarity.nearDuplicates.length} exceeds ${policy.maxNearDuplicatePairs}`);
  if (similarity.assistantCopies.length > 0) failures.push(`holdout assistant-copy pairs ${similarity.assistantCopies.length} exceeds 0`);
  if (scenarioFamilies.violations.length > 0) failures.push(`${scenarioFamilies.violations.length} scenario families cross splits`);
  if (templateFamilies.violations.length > 0) failures.push(`${templateFamilies.violations.length} template families cross splits`);
  if (!validateProtectedSplits(register)) failures.push('quality and safety holdouts are not fail-closed against training and routine iteration');
  if (diversity.uniqueAssistantTargetRatio < policy.minUniqueAssistantTargetRatio) failures.push('unique assistant-target ratio is below policy');
  for (const size of [1, 2, 3]) {
    if (diversity[`distinct${size}`] < policy[`minDistinct${size}`]) failures.push(`distinct-${size} is below policy`);
  }
  if (diversity.highestRepeatedOpeningShare > policy.maxRepeatedOpeningShare) {
    failures.push('highest repeated-opening share exceeds policy');
  }

  return {
    schema: 'com.saferide.gemma4.dataset-audit',
    schemaVersion: 1,
    datasetId: register.sources?.[0]?.datasetId ?? 'unknown',
    registerId: register.registerId,
    dataSha256,
    registerSha256,
    auditImplementation: {
      script: path.relative(repoRoot, auditScriptPath).replaceAll('\\', '/'),
      sha256: sha256(fs.readFileSync(auditScriptPath, 'utf8').replace(/\r\n/g, '\n')),
    },
    generatedFromDate: String(register.createdAt).slice(0, 10),
    rowCount: rows.length,
    splitCounts: rows.reduce((result, row) => ({ ...result, [row.split]: (result[row.split] ?? 0) + 1 }), {}),
    familyIsolation: { scenarioFamilies, templateFamilies },
    overlap: {
      exactTurn,
      normalizedTurn,
      exactConversation,
      normalizedConversation,
      nearDuplicates: similarity.nearDuplicates,
      holdoutAssistantCopies: similarity.assistantCopies,
    },
    diversity,
    protectedHoldouts: {
      configured: validateProtectedSplits(register),
      splits: register.protectedSplits?.splits ?? [],
    },
    semanticNearDuplicateMethod: 'content-free TF cosine proxy; independent semantic-model review remains an external promotion input',
    passed: failures.length === 0,
    failures,
  };
}

function parseArgs(argv) {
  const args = { ...defaults, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--data') args.data = argv[++index];
    else if (argument === '--register') args.register = argv[++index];
    else if (argument === '--report') args.report = argv[++index];
    else if (argument === '--check') args.check = true;
    else if (argument === '--help' || argument === '-h') {
      console.log('Usage: node scripts/saferide-gemma4-dataset-audit.mjs [--check] [--data <jsonl>] [--register <json>] [--report <json>]');
      process.exit(0);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return args;
}

function resolve(input) {
  return path.isAbsolute(input) ? input : path.join(repoRoot, input);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dataPath = resolve(args.data);
  const registerPath = resolve(args.register);
  const reportPath = resolve(args.report);
  const dataText = fs.readFileSync(dataPath, 'utf8').replace(/\r\n/g, '\n');
  const registerText = fs.readFileSync(registerPath, 'utf8').replace(/\r\n/g, '\n');
  const register = JSON.parse(registerText);
  if (register.generator?.dataSha256 !== sha256(dataText)) throw new Error('Register data SHA-256 does not match dataset bytes');
  const report = auditDataset({
    rows: parseJsonl(dataText),
    register,
    dataSha256: sha256(dataText),
    registerSha256: sha256(registerText),
  });
  const reportText = `${JSON.stringify(report, null, 2)}\n`;
  if (args.check) {
    if (!fs.existsSync(reportPath)) throw new Error(`Audit report missing: ${path.relative(repoRoot, reportPath)}`);
    if (fs.readFileSync(reportPath, 'utf8').replace(/\r\n/g, '\n') !== reportText) throw new Error('Dataset audit report is stale');
  } else {
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, reportText, 'utf8');
  }
  console.log(`SafeRide v0.4 dataset audit: ${report.passed ? 'PASS' : 'BLOCKED'}`);
  console.log(`Rows: ${report.rowCount}; assistant target uniqueness: ${report.diversity.uniqueAssistantTargetRatio.toFixed(4)}`);
  console.log(`Cross-split near-duplicate pairs: ${report.overlap.nearDuplicates.length}`);
  for (const failure of report.failures) console.log(`- ${failure}`);
  if (!report.passed) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
