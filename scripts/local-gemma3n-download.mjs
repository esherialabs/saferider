#!/usr/bin/env node
// Legacy Gemma 3n GGUF dev-smoke helper. The active SafeRide target is
// litert-community/gemma-4-E2B-it-litert-lm via LiteRT-LM; do not use this for
// release-like builds, UNICEF evidence, or current model-readiness claims.
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

const MODEL = {
  id: 'base-gemma-3n-e4b-it-ud-iq2-xxs-gguf',
  repo: 'unsloth/gemma-3n-E4B-it-GGUF',
  revision: '90fa8b0e431faeae50c305828bc260d6f71720e1',
  fileName: 'gemma-3n-E4B-it-UD-IQ2_XXS.gguf',
  sizeBytes: 2_830_964_864,
  sha256: '8fe1ea0ddfdc4e32be0acfb52c3fd84fb4b52e7f2a7842a5736d60e5a78531c4',
};

const args = new Set(process.argv.slice(2));
const modelDir = path.resolve('.models', MODEL.id);
const modelPath = path.join(modelDir, MODEL.fileName);
const partialPath = `${modelPath}.part`;
const downloadUrl = `https://huggingface.co/${MODEL.repo}/resolve/${MODEL.revision}/${MODEL.fileName}?download=true`;
const INACTIVITY_TIMEOUT_MS = 60_000;

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / (1024 * 1024))} MB`;
  return `${bytes} bytes`;
}

async function fileSize(filePath) {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

async function hashFile(filePath) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest('hex');
}

async function verifyExisting(filePath) {
  const size = await fileSize(filePath);
  if (size !== MODEL.sizeBytes) {
    return { ok: false, reason: `size ${formatBytes(size)} does not match ${formatBytes(MODEL.sizeBytes)}` };
  }
  const digest = await hashFile(filePath);
  if (digest !== MODEL.sha256) {
    return { ok: false, reason: `sha256 ${digest} does not match ${MODEL.sha256}` };
  }
  return { ok: true, reason: `verified ${filePath}` };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function downloadModel(options = {}) {
  await mkdir(modelDir, { recursive: true });

  if (options.force) {
    await rm(modelPath, { force: true });
    await rm(partialPath, { force: true });
  }

  const existing = await verifyExisting(modelPath).catch(error => ({ ok: false, reason: error.message }));
  if (existing.ok) {
    console.log(existing.reason);
    return;
  }

  let receivedBytes = await fileSize(partialPath);
  if (receivedBytes === MODEL.sizeBytes) {
    console.log('Found complete partial download. Verifying sha256...');
    const digest = await hashFile(partialPath);
    if (digest !== MODEL.sha256) {
      throw new Error(`Checksum mismatch: ${digest} does not match ${MODEL.sha256}`);
    }
    await rename(partialPath, modelPath);
    console.log(`Model ready: ${modelPath}`);
    return;
  }
  if (receivedBytes > MODEL.sizeBytes) {
    await rm(partialPath, { force: true });
    receivedBytes = 0;
  }

  const headers = {
    'User-Agent': 'saferide-gemma3n-runtime-smoke',
  };
  if (receivedBytes > 0) {
    headers.Range = `bytes=${receivedBytes}-`;
  }

  console.log(`Downloading ${MODEL.repo}/${MODEL.fileName}`);
  console.log(`Target: ${modelPath}`);
  console.log(`Expected size: ${formatBytes(MODEL.sizeBytes)}`);
  if (receivedBytes > 0) console.log(`Resuming from ${formatBytes(receivedBytes)}`);

  const abortController = new AbortController();
  let inactivityTimer;
  const resetInactivityTimer = () => {
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
      abortController.abort(new Error('No download progress for 60 seconds.'));
    }, INACTIVITY_TIMEOUT_MS);
  };
  resetInactivityTimer();

  const response = await fetch(downloadUrl, { headers, redirect: 'follow', signal: abortController.signal });
  if (!response.ok && response.status !== 206) {
    throw new Error(`Download failed with HTTP ${response.status} ${response.statusText}`);
  }

  const canAppend = response.status === 206 && receivedBytes > 0;
  if (!canAppend && receivedBytes > 0) {
    await rm(partialPath, { force: true });
    receivedBytes = 0;
  }

  let lastLogAt = Date.now();
  const progress = new Transform({
    transform(chunk, _encoding, callback) {
      resetInactivityTimer();
      receivedBytes += chunk.length;
      const now = Date.now();
      if (now - lastLogAt > 5000) {
        const percent = ((receivedBytes / MODEL.sizeBytes) * 100).toFixed(1);
        console.log(`${percent}% (${formatBytes(receivedBytes)} / ${formatBytes(MODEL.sizeBytes)})`);
        lastLogAt = now;
      }
      callback(null, chunk);
    },
  });

  await pipeline(
    Readable.fromWeb(response.body),
    progress,
    createWriteStream(partialPath, { flags: canAppend ? 'a' : 'w' }),
  ).finally(() => {
    clearTimeout(inactivityTimer);
  });

  const partialSize = await fileSize(partialPath);
  if (partialSize !== MODEL.sizeBytes) {
    throw new Error(`Incomplete download: ${formatBytes(partialSize)} of ${formatBytes(MODEL.sizeBytes)}`);
  }

  console.log('Verifying sha256...');
  const digest = await hashFile(partialPath);
  if (digest !== MODEL.sha256) {
    throw new Error(`Checksum mismatch: ${digest} does not match ${MODEL.sha256}`);
  }

  await rename(partialPath, modelPath);
  console.log(`Model ready: ${modelPath}`);
}

if (args.has('--print-path')) {
  console.log(modelPath);
} else if (args.has('--check')) {
  const result = await verifyExisting(modelPath).catch(error => ({ ok: false, reason: error.message }));
  console.log(result.reason);
  process.exit(result.ok ? 0 : 1);
} else {
  const maxAttempts = Number(process.env.SAFERIDE_MODEL_DOWNLOAD_ATTEMPTS ?? '5');
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await downloadModel({ force: args.has('--force') && attempt === 1 });
      process.exit(0);
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      console.warn(`Download attempt ${attempt} failed: ${error.message}`);
      console.warn('Retrying with resume...');
      await sleep(5000);
    }
  }
}
