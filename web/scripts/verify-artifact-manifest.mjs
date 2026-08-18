import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'out');
const manifestPath = path.join(outDir, 'artifact-manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.error(`Missing artifact manifest: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const failures = [];

for (const file of manifest.files ?? []) {
  const fullPath = path.join(outDir, file.path);

  if (!fs.existsSync(fullPath)) {
    failures.push(`${file.path}: missing`);
    continue;
  }

  const buffer = fs.readFileSync(fullPath);
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  if (buffer.length !== file.bytes) {
    failures.push(`${file.path}: expected ${file.bytes} bytes, found ${buffer.length}`);
  }

  if (sha256 !== file.sha256) {
    failures.push(`${file.path}: sha256 mismatch`);
  }
}

if (failures.length > 0) {
  console.error(`Artifact manifest verification failed:\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`Verified artifact manifest with ${manifest.files.length} files.`);
