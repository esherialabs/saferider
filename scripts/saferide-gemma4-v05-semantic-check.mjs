#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  canonicalSha256,
  compileV05Schemas,
  fileSha256,
  readJson,
  schemaErrors,
  sha256,
} from './lib/saferide-gemma4-v05.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAXIMUM_SEMANTIC_CLUSTER_SHARE = 0.03;

function resolve(input) {
  return path.isAbsolute(input) ? input : path.join(repoRoot, input);
}

function rowSplitsFromManifest(splitManifest) {
  const result = new Map();
  for (const assignment of splitManifest.assignments ?? []) {
    for (const rowId of Object.values(assignment.rowIds ?? {})) result.set(rowId, assignment.split);
  }
  return result;
}

function clusterDistribution(assignments) {
  const counts = new Map();
  for (const assignment of assignments) {
    const clusterId = typeof assignment?.clusterId === 'string' ? assignment.clusterId : '<invalid>';
    counts.set(clusterId, (counts.get(clusterId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([clusterId, rowCount]) => ({ clusterId, rowCount }));
}

function expectedCrossSplitPairCount(rowSplits) {
  const splitCounts = new Map();
  for (const split of rowSplits.values()) splitCounts.set(split, (splitCounts.get(split) ?? 0) + 1);
  const counts = [...splitCounts.values()];
  let total = 0;
  for (let left = 0; left < counts.length; left += 1) {
    for (let right = left + 1; right < counts.length; right += 1) total += counts[left] * counts[right];
  }
  return total;
}

export function validateSemanticLeakageArtifacts({
  report,
  details,
  splitManifest,
  datasetManifestSha256,
  splitManifestSha256,
  detailsSha256 = null,
  schemas = compileV05Schemas(),
}) {
  const errors = [
    ...schemaErrors('semanticReport', schemas.semanticReport, report),
    ...schemaErrors('semanticDetails', schemas.semanticDetails, details),
  ];
  if (report.reportId !== details.reportId || report.datasetId !== details.datasetId || report.status !== details.status) {
    errors.push('semantic public and restricted artifacts disagree on identity or status');
  }
  if (report.datasetArtifactManifestSha256 !== datasetManifestSha256
    || details.datasetArtifactManifestSha256 !== datasetManifestSha256) {
    errors.push('semantic artifacts do not bind the exact dataset manifest');
  }
  if (report.splitManifestSha256 !== splitManifestSha256
    || details.splitManifestSha256 !== splitManifestSha256) {
    errors.push('semantic artifacts do not bind the exact split manifest');
  }
  if (detailsSha256 && report.restrictedDetails?.sha256 !== detailsSha256) {
    errors.push('semantic public report does not bind the restricted detail bytes');
  }
  if (details.methodSha256 !== canonicalSha256(report.method)) errors.push('semantic method binding is stale');
  if (details.threshold !== report.threshold
    || details.rowCount !== report.rowCount
    || details.evaluatedCrossSplitPairCount !== report.crossSplitPairCount
    || details.unresolvedPairCount !== report.unresolvedPairCount
    || details.maximumSimilarity !== report.maximumSimilarity) {
    errors.push('semantic public and restricted count, threshold, or similarity fields disagree');
  }
  if (details.pairInventorySha256 !== canonicalSha256(details.pairs ?? [])
    || report.pairInventorySha256 !== details.pairInventorySha256) {
    errors.push('semantic flagged-pair inventory hash is stale');
  }
  if ((details.pairs ?? []).length > details.evaluatedCrossSplitPairCount) {
    errors.push('semantic flagged-pair inventory exceeds the evaluated cross-split pair count');
  }

  const rowSplits = rowSplitsFromManifest(splitManifest);
  const expectedRowIds = [...rowSplits.keys()].sort();
  const expectedPairCount = expectedCrossSplitPairCount(rowSplits);
  if (expectedPairCount !== 1_930_000
    || details.evaluatedCrossSplitPairCount !== expectedPairCount
    || report.crossSplitPairCount !== expectedPairCount) {
    errors.push(`semantic analysis must evaluate all ${expectedPairCount} cross-split row pairs`);
  }
  const assignments = details.clusters?.assignments ?? [];
  const assignedRowIds = assignments.map(assignment => assignment.rowId);
  if (rowSplits.size !== 2600
    || assignments.length !== 2600
    || new Set(assignedRowIds).size !== 2600
    || assignedRowIds.some(rowId => !rowSplits.has(rowId))) {
    errors.push('semantic cluster assignments must cover each frozen row exactly once');
  }
  if (details.clusters?.rowInventorySha256 !== sha256(expectedRowIds.join('\n'))) {
    errors.push('semantic cluster row-inventory hash is stale');
  }
  const distribution = clusterDistribution(assignments);
  const distributionSha256 = canonicalSha256(distribution);
  const largestClusterRows = distribution.reduce((maximum, entry) => Math.max(maximum, entry.rowCount), 0);
  const largestClusterShare = largestClusterRows / 2600;
  if (details.clusters?.distributionSha256 !== distributionSha256
    || report.clusterDistribution?.distributionSha256 !== distributionSha256
    || report.clusterDistribution?.clusterCount !== distribution.length
    || report.clusterDistribution?.largestClusterRows !== largestClusterRows
    || report.clusterDistribution?.largestClusterShare !== largestClusterShare) {
    errors.push('semantic cluster distribution is stale or disagrees with restricted assignments');
  }
  if (largestClusterShare > MAXIMUM_SEMANTIC_CLUSTER_SHARE) {
    errors.push('semantic cluster distribution exceeds the 3% maximum cluster share');
  }

  let invalidPairCount = 0;
  let unresolvedPairCount = 0;
  const pairIds = new Set();
  for (const pair of details.pairs ?? []) {
    const leftRowId = typeof pair?.leftRowId === 'string' ? pair.leftRowId : '';
    const rightRowId = typeof pair?.rightRowId === 'string' ? pair.rightRowId : '';
    const expectedPairId = sha256([leftRowId, rightRowId].sort().join('\n'));
    const distinctApproved = pair.disposition === 'distinct-after-independent-review'
      && typeof pair.adjudicationEvidenceRef === 'string';
    if (pair.disposition === 'unresolved') unresolvedPairCount += 1;
    if (pairIds.has(pair.pairId)
      || pair.pairId !== expectedPairId
      || leftRowId.localeCompare(rightRowId) >= 0
      || !rowSplits.has(leftRowId)
      || !rowSplits.has(rightRowId)
      || rowSplits.get(leftRowId) !== pair.leftSplit
      || rowSplits.get(rightRowId) !== pair.rightSplit
      || pair.leftSplit === pair.rightSplit
      || pair.similarity < report.threshold
      || (!distinctApproved && pair.disposition !== 'unresolved')) {
      invalidPairCount += 1;
    }
    pairIds.add(pair.pairId);
  }
  if (invalidPairCount) errors.push(`semantic restricted details contain ${invalidPairCount} invalid cross-split pair records`);
  if (unresolvedPairCount !== report.unresolvedPairCount) errors.push('semantic unresolved-pair count disagrees with restricted records');
  if ((details.pairs ?? []).length > 0) {
    const maximum = Math.max(...details.pairs.map(pair => pair.similarity));
    if (maximum !== report.maximumSimilarity) errors.push('semantic maximum similarity disagrees with restricted flagged pairs');
  } else if (report.maximumSimilarity >= report.threshold) {
    errors.push('semantic maximum similarity reaches the review threshold without a flagged-pair record');
  }
  if (report.status === 'passed' && (invalidPairCount || unresolvedPairCount || report.review?.status !== 'approved')) {
    errors.push('passed semantic status requires valid, independently approved records with zero unresolved pairs');
  }
  if (report.status === 'passed' && (!details.embeddingArtifact
    || details.privacy?.containsEmbeddings !== true
    || report.restrictedDetails?.containsEmbeddings !== true)) {
    errors.push('passed semantic status requires a hash-bound restricted embedding artifact');
  }
  if (report.restrictedDetails?.containsEmbeddings !== details.privacy?.containsEmbeddings) {
    errors.push('semantic embedding custody metadata disagrees between public and restricted artifacts');
  }
  return errors;
}

function parseArgs(argv) {
  const args = { contractCheck: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--contract-check') args.contractCheck = true;
    else if (argument === '--report') args.report = argv[++index];
    else if (argument === '--details') args.details = argv[++index];
    else if (argument === '--dataset-manifest') args.datasetManifest = argv[++index];
    else if (argument === '--split-manifest') args.splitManifest = argv[++index];
    else if (['--help', '-h'].includes(argument)) {
      console.log('Usage: node scripts/saferide-gemma4-v05-semantic-check.mjs --contract-check\n   or: --report <json> --details <restricted-json> --dataset-manifest <json> --split-manifest <json>');
      process.exit(0);
    } else throw new Error(`Unknown or incomplete argument: ${argument}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.contractCheck) {
    compileV05Schemas();
    console.log('SafeRide v0.5 external semantic-leakage artifact contract: PASS.');
    console.log('No embedding model was downloaded or executed; real results and independent review remain blocked.');
    return 0;
  }
  for (const field of ['report', 'details', 'datasetManifest', 'splitManifest']) {
    if (!args[field]) throw new Error(`--${field.replace(/[A-Z]/g, value => `-${value.toLowerCase()}`)} is required`);
  }
  const paths = Object.fromEntries(Object.entries(args)
    .filter(([, value]) => typeof value === 'string')
    .map(([key, value]) => [key, resolve(value)]));
  const report = readJson(paths.report);
  const details = readJson(paths.details);
  const splitManifest = readJson(paths.splitManifest);
  const errors = validateSemanticLeakageArtifacts({
    report,
    details,
    splitManifest,
    datasetManifestSha256: fileSha256(paths.datasetManifest),
    splitManifestSha256: fileSha256(paths.splitManifest),
    detailsSha256: fileSha256(paths.details),
  });
  console.log('SafeRide v0.5 restricted semantic-leakage artifact check');
  console.log(`Rows: ${report.rowCount}; flagged pairs: ${(details.pairs ?? []).length}; unresolved: ${report.unresolvedPairCount}`);
  if (errors.length) {
    errors.forEach(error => console.error(`- ${error}`));
    return 1;
  }
  console.log('PASS (hash-bound external method, row coverage, clusters, pair adjudication, and restricted custody).');
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
