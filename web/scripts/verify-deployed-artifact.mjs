import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const outDir = path.join(process.cwd(), 'out');
const manifestPath = path.join(outDir, 'artifact-manifest.json');
const origin = (process.env.DEPLOYED_ORIGIN ?? '').replace(/\/+$/, '');
const concurrency = Number(process.env.DEPLOY_VERIFY_CONCURRENCY ?? 8);

if (!origin.startsWith('https://')) {
  console.error('DEPLOYED_ORIGIN must be an https:// origin.');
  process.exit(1);
}

if (!fs.existsSync(manifestPath)) {
  console.error(`Missing artifact manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const files = manifest.files ?? [];
const failures = [];
let cursor = 0;

if (files.length === 0) {
  console.error('Artifact manifest contains no files.');
  process.exit(1);
}

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 32) {
  console.error('DEPLOY_VERIFY_CONCURRENCY must be an integer from 1 to 32.');
  process.exit(1);
}

async function fetchFile(file) {
  const url = `${origin}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { 'cache-control': 'no-cache' },
        redirect: 'error',
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      const sha256 = createHash('sha256').update(buffer).digest('hex');

      if (buffer.length !== file.bytes) {
        throw new Error(`expected ${file.bytes} bytes, received ${buffer.length}`);
      }

      if (sha256 !== file.sha256) {
        throw new Error('sha256 mismatch');
      }

      return;
    } catch (error) {
      lastError = error;
    }
  }

  failures.push(`${file.path}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function worker() {
  while (cursor < files.length) {
    const file = files[cursor];
    cursor += 1;
    await fetchFile(file);
  }
}

await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));

if (failures.length > 0) {
  console.error(`Deployed artifact verification failed for ${failures.length} file(s):\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`Verified ${files.length} deployed files against the release manifest at ${origin}.`);
