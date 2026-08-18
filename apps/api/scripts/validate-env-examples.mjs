#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const apiRoot = path.resolve(path.dirname(__filename), '..');
const repoRoot = path.resolve(apiRoot, '..', '..');
const builtEnvModule = path.join(apiRoot, 'dist', 'config', 'env.js');

function parseEnvFile(filePath) {
  return Object.fromEntries(
    fs
      .readFileSync(filePath, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.startsWith('#'))
      .map(line => {
        const separator = line.indexOf('=');
        if (separator === -1) {
          return null;
        }

        const key = line.slice(0, separator).trim();
        const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
        return [key, value];
      })
      .filter(Boolean),
  );
}

function validateBuiltEnv(label, envValues) {
  if (!fs.existsSync(builtEnvModule)) {
    throw new Error('apps/api must be built before validating env examples.');
  }

  const script = `await import(${JSON.stringify(pathToFileURL(builtEnvModule).href)});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: apiRoot,
    env: {
      ...process.env,
      ...envValues,
    },
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    process.stderr.write(`Env validation failed for ${label}\n`);
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  console.log(`Env validation passed for ${label}`);
}

const apiExample = parseEnvFile(path.join(apiRoot, '.env.example'));
validateBuiltEnv('apps/api/.env.example', apiExample);

const localExample = parseEnvFile(path.join(repoRoot, 'infra', 'local', '.env.example'));
const localHost = localExample.LOCAL_PUBLIC_HOST || 'localhost';
const localApiPort = localExample.LOCAL_API_PORT || '3333';
const localWsPort = localExample.LOCAL_WS_PORT || '3334';
const localMinioPort = localExample.LOCAL_MINIO_API_PORT || '9000';
const localBucket = localExample.LOCAL_MINIO_BUCKET || 'evidence';

validateBuiltEnv('infra/local/.env.example API service mapping', {
  NODE_ENV: 'development',
  API_HOST: '0.0.0.0',
  API_PORT: localApiPort,
  WS_HOST: '0.0.0.0',
  WS_PORT: localWsPort,
  API_PUBLIC_BASE_URL: `http://${localHost}:${localApiPort}/api`,
  WS_PUBLIC_BASE_URL: `ws://${localHost}:${localWsPort}`,
  AUTH_PUBLIC_BASE_URL: `http://${localHost}:${localApiPort}/auth`,
  STORAGE_PUBLIC_BASE_URL: `http://${localHost}:${localMinioPort}/${localBucket}`,
  DATABASE_URL: `postgres://${localExample.LOCAL_POSTGRES_USER}:${localExample.LOCAL_POSTGRES_PASSWORD}@postgres:5432/${localExample.LOCAL_POSTGRES_DB}`,
  REDIS_URL: 'redis://redis:6379',
  AUTH_JWT_SECRET: localExample.LOCAL_AUTH_JWT_SECRET,
  S3_ENDPOINT: 'http://minio:9000',
  S3_PUBLIC_ENDPOINT: `http://${localHost}:${localMinioPort}`,
  S3_REGION: 'local',
  S3_BUCKET: localBucket,
  S3_ACCESS_KEY_ID: localExample.LOCAL_MINIO_ROOT_USER,
  S3_SECRET_ACCESS_KEY: localExample.LOCAL_MINIO_ROOT_PASSWORD,
  CORS_ORIGINS: localExample.LOCAL_API_CORS_ORIGINS || '*',
  LOG_LEVEL: localExample.LOCAL_API_LOG_LEVEL || 'info',
});
