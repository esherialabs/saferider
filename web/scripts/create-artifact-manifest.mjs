import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const outDir = path.join(root, 'out');
const manifestPath = path.join(outDir, 'artifact-manifest.json');

if (!fs.existsSync(outDir)) {
  console.error(`Static output directory does not exist: ${outDir}`);
  process.exit(1);
}

const files = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    const relativePath = path.relative(outDir, fullPath).replaceAll(path.sep, '/');

    if (relativePath === 'artifact-manifest.json') {
      continue;
    }

    const buffer = fs.readFileSync(fullPath);
    files.push({
      path: relativePath,
      bytes: buffer.length,
      sha256: createHash('sha256').update(buffer).digest('hex'),
    });
  }
}

walk(outDir);
files.sort((a, b) => a.path.localeCompare(b.path));

const manifest = {
  version: 1,
  createdAt: new Date().toISOString(),
  fileCount: files.length,
  files,
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Created artifact manifest with ${files.length} files.`);
