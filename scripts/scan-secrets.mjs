#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, '..');
const stagedOnly = process.argv.includes('--staged');

const ignoredDirs = new Set([
  '.ai-smoke',
  '.git',
  '.gradle',
  '.cxx',
  '.expo',
  '.models',
  '.next',
  '.venv-ai',
  'build',
  'dist',
  'node_modules',
  'out',
  '__pycache__',
  'web-build',
]);

const ignoredFiles = new Set([
  '.env',
  '.env.local',
  '.env.development',
  '.env.docker',
  'apps/api/package-lock.json',
  'package-lock.json',
  'web/package-lock.json',
]);

const ignoredExtensions = new Set([
  '.avif',
  '.gguf',
  '.gif',
  '.ico',
  '.jpeg',
  '.jpg',
  '.jar',
  '.keystore',
  '.mp4',
  '.pdf',
  '.png',
  '.so',
  '.ttf',
  '.webp',
  '.woff',
  '.woff2',
]);

const MAX_SCAN_FILE_BYTES = 10 * 1024 * 1024;

const placeholderPattern =
  /^(replace|change|your|todo|example|placeholder|xxx|local-|test-|dummy|false|true|null|undefined|env\()/i;

const detectors = [
  {
    name: 'OpenAI-style API key',
    pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  },
  {
    name: 'JWT-looking token',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    name: 'AWS access key',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  },
  {
    name: 'GitHub token',
    pattern: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/g,
  },
  {
    name: 'Private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |)?PRIVATE KEY-----/g,
  },
  {
    name: 'Bearer token literal',
    pattern: /\bBearer\s+[A-Za-z0-9._-]{20,}\b/g,
  },
  {
    name: 'Database URL with password',
    pattern: /\bpostgres(?:ql)?:\/\/[^:\s/@]+:[^@\s]+@[^)\s'"]+/gi,
  },
];

const assignmentPattern =
  /\b(api[_-]?key|apikey|secret|token|password|service[_-]?role|database[_-]?url|connection[_-]?string)\b\s*[:=]\s*["']?([^"'\s#,)}\]]+)/gi;

function normalize(filePath) {
  return filePath.split(path.sep).join('/');
}

function isIgnored(filePath) {
  const relative = normalize(path.relative(root, filePath));
  const basename = path.basename(relative);
  if (!relative || ignoredFiles.has(relative)) return true;
  if (['.env', '.env.local', '.env.development', '.env.docker'].includes(basename)) return true;
  if (/^\.env\..*local$/.test(relative)) return true;
  if (/^\.env.*local$/.test(basename)) return true;
  if (ignoredExtensions.has(path.extname(relative).toLowerCase())) return true;

  return relative.split('/').some(part => ignoredDirs.has(part) || part.startsWith('.tmp-apk-'));
}

function listAllFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (isIgnored(fullPath)) continue;

    if (entry.isDirectory()) {
      files.push(...listAllFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }

  return files;
}

function listStagedFiles() {
  let output = '';

  try {
    output = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMRT'], {
      cwd: root,
      encoding: 'utf8',
    });
  } catch {
    console.warn('Unable to inspect staged files with git; falling back to full tree scan.');
    return listAllFiles(root);
  }

  return output
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(relative => path.join(root, relative))
    .filter(filePath => fs.existsSync(filePath) && !isIgnored(filePath));
}

function isAllowedValue(value) {
  const normalized = value.trim().replace(/^['"`]+|['"`;,]+$/g, '');
  if (!normalized) return true;
  if (placeholderPattern.test(normalized)) return true;
  if (/(replace|change|your|todo|example|placeholder|xxx)/i.test(normalized)) return true;
  if (normalized.includes('${')) return true;
  if (/^(process|Deno)\.env\b/.test(normalized)) return true;
  if (/^(getEnvValue|requiredEnv|optionalEnv|requiredBooleanEnv|numberEnv)\(/.test(normalized)) return true;
  if (/^\$\{?[A-Z0-9_]+\}?$/.test(normalized)) return true;
  if (/^[A-Z0-9_]+$/.test(normalized)) return true;
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(normalized)) return true;
  if (/[.(){}|]/.test(normalized)) return true;
  return false;
}

function isSuspiciousLiteral(value) {
  const normalized = value.trim().replace(/^['"`]+|['"`;,]+$/g, '');
  if (isAllowedValue(normalized)) return false;
  if (normalized.length < 12) return false;
  if (!/^[A-Za-z0-9+/_:=.-]+$/.test(normalized)) return false;

  const classes = [
    /[a-z]/.test(normalized),
    /[A-Z]/.test(normalized),
    /[0-9]/.test(normalized),
    /[+/_:=.-]/.test(normalized),
  ].filter(Boolean).length;

  return classes >= 2;
}

function inspectFile(filePath) {
  const fileStat = fs.statSync(filePath);
  if (fileStat.size > MAX_SCAN_FILE_BYTES) return [];

  const contents = fs.readFileSync(filePath);
  if (contents.includes(0)) return [];

  const text = contents.toString('utf8');
  const findings = [];

  for (const detector of detectors) {
    for (const match of text.matchAll(detector.pattern)) {
      if (isAllowedValue(match[0])) continue;
      findings.push({
        detector: detector.name,
        index: match.index ?? 0,
      });
    }
  }

  for (const match of text.matchAll(assignmentPattern)) {
    if (isSuspiciousLiteral(match[2] ?? '')) {
      findings.push({
        detector: 'Sensitive assignment with literal value',
        index: match.index ?? 0,
      });
    }
  }

  return findings.map(finding => {
    const prefix = text.slice(0, finding.index);
    const line = prefix.split(/\r?\n/).length;
    return {
      ...finding,
      file: normalize(path.relative(root, filePath)),
      line,
    };
  });
}

const files = stagedOnly ? listStagedFiles() : listAllFiles(root);
const findings = files.flatMap(inspectFile);

if (findings.length > 0) {
  console.error('Potential committed secrets found:');
  for (const finding of findings) {
    console.error(`- ${finding.file}:${finding.line} (${finding.detector})`);
  }
  console.error('Move live values to ignored env files or a secret manager before committing.');
  process.exit(1);
}

console.log(`Secret scan passed (${files.length} file${files.length === 1 ? '' : 's'} checked).`);
