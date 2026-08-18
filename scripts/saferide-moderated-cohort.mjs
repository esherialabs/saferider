#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FORBIDDEN_KEYS = new Set([
  'narrative', 'incidentnarrative', 'description', 'evidence', 'evidencecontent',
  'exactlocation', 'coordinates', 'latitude', 'longitude', 'contact', 'phone',
  'email', 'authtoken', 'token', 'prompt', 'completion', 'participant',
  'participantid', 'participantname', 'name', 'address', 'sessionid', 'eventid',
  'issueid', 'deviceid', 'deviceserial',
]);

function readSchema(name) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas', name), 'utf8'));
}

const ajv = new Ajv2020({ allErrors: true, strict: false, validateFormats: false });
const validateSessionShape = ajv.compile(readSchema('moderated-session-aggregate.schema.json'));
const validateSummaryShape = ajv.compile(readSchema('moderated-cohort-summary.schema.json'));

function normalizeKey(value) {
  return value.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
}

export function findForbiddenMeasurementPath(value, currentPath = '$') {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findForbiddenMeasurementPath(value[index], `${currentPath}[${index}]`);
      if (found) return found;
    }
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(normalizeKey(key))) return `${currentPath}.${key}`;
    const found = findForbiddenMeasurementPath(child, `${currentPath}.${key}`);
    if (found) return found;
  }
  return null;
}

export function validateModeratedSession(session) {
  const errors = [];
  if (!validateSessionShape(session)) {
    errors.push(...(validateSessionShape.errors ?? []).map(error => (
      `${error.instancePath || '$'} ${error.message ?? 'is invalid'}`
    )));
  }
  const forbiddenPath = findForbiddenMeasurementPath(session);
  if (forbiddenPath) errors.push(`forbidden sensitive field at ${forbiddenPath}`);
  if (session?.reportTask?.completed === true) {
    if (session.reportTask.timeToReportMsBucket === null) errors.push('completed report requires timeToReportMsBucket');
    if (session.reportTask.dropOffStep !== null) errors.push('completed report must not have a dropOffStep');
  } else if (session?.reportTask) {
    if (session.reportTask.timeToReportMsBucket !== null) errors.push('incomplete report must not have a completion time');
    if (session.reportTask.dropOffStep === null) errors.push('incomplete report requires a dropOffStep');
  }
  return [...new Set(errors)];
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2 / 15000) * 15000
    : sorted[middle];
}

function mean(values) {
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
}

export function buildModeratedCohortSummary(sessions, generatedAt = new Date()) {
  if (!Array.isArray(sessions) || sessions.length < 15 || sessions.length > 25) {
    throw new Error('Exactly 15 to 25 schema-valid moderated session aggregates are required.');
  }
  const sequences = new Set();
  sessions.forEach((session, index) => {
    const errors = validateModeratedSession(session);
    if (errors.length) throw new Error(`session ${index + 1}: ${errors.join('; ')}`);
    if (sequences.has(session.sessionSequence)) throw new Error(`duplicate sessionSequence ${session.sessionSequence}`);
    sequences.add(session.sessionSequence);
  });

  const completed = sessions.filter(session => session.reportTask.completed);
  const unassisted = completed.filter(session => session.reportTask.assistance === 'none');
  const completionTimes = completed.map(session => session.reportTask.timeToReportMsBucket);
  const dropOffsByStep = {};
  for (const session of sessions) {
    if (session.reportTask.dropOffStep) {
      dropOffsByStep[session.reportTask.dropOffStep] = (dropOffsByStep[session.reportTask.dropOffStep] ?? 0) + 1;
    }
  }
  const issueCounts = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const session of sessions) {
    for (const severity of Object.keys(issueCounts)) issueCounts[severity] += session.issueCounts[severity];
  }
  const unassistedCompletionRate = unassisted.length / sessions.length;
  const summary = {
    schemaVersion: 'moderated-cohort-summary.v1',
    generatedAt: generatedAt.toISOString(),
    syntheticOnly: true,
    contentFree: true,
    sessionCount: sessions.length,
    reportStarts: sessions.length,
    reportCompletions: completed.length,
    unassistedReportCompletions: unassisted.length,
    completionRate: completed.length / sessions.length,
    unassistedCompletionRate,
    unassistedThreshold: 0.8,
    thresholdResult: unassistedCompletionRate >= 0.8 ? 'pass' : 'fail',
    medianTimeToReportMsBucket: median(completionTimes),
    dropOffsByStep,
    retries: sessions.reduce((sum, session) => sum + session.reportTask.retries, 0),
    errors: sessions.reduce((sum, session) => sum + session.reportTask.errorCount, 0),
    meanRatings: {
      comprehension: mean(sessions.map(session => session.ratings.comprehension)),
      accessibility: mean(sessions.map(session => session.ratings.accessibility)),
      referralClarity: mean(sessions.map(session => session.ratings.referralClarity)),
      errorRecovery: mean(sessions.map(session => session.ratings.errorRecovery)),
    },
    issueCounts,
  };
  if (!validateSummaryShape(summary)) {
    throw new Error(`generated cohort summary is invalid: ${(validateSummaryShape.errors ?? []).map(error => `${error.instancePath} ${error.message}`).join('; ')}`);
  }
  return summary;
}

export function aggregateSessionDirectory(directory, generatedAt = new Date()) {
  const resolved = path.resolve(directory);
  const files = fs.readdirSync(resolved).filter(file => file.endsWith('.json')).sort();
  const sessions = files.map(file => JSON.parse(fs.readFileSync(path.join(resolved, file), 'utf8')));
  return buildModeratedCohortSummary(sessions, generatedAt);
}

export function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function parseArgs(argv) {
  const options = { sessions: null, output: null };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--sessions') options.sessions = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  if (!options.sessions || !options.output) throw new Error('--sessions and --output are required');
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const summary = aggregateSessionDirectory(options.sessions);
    const output = path.resolve(options.output);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx' });
    console.log(`Wrote content-free cohort summary for ${summary.sessionCount} sessions: ${output}`);
    console.log(`SHA-256: ${sha256File(output)}`);
    if (summary.thresholdResult !== 'pass') {
      console.error('Unassisted report completion is below the declared 80 percent gate.');
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
