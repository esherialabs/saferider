import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const publicDir = path.join(root, 'public');
const maxImageBytes = 250 * 1024;
const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();

    if (!['.png', '.jpg', '.jpeg', '.webp', '.avif'].includes(extension)) {
      continue;
    }

    const size = fs.statSync(fullPath).size;

    if (size > maxImageBytes) {
      failures.push(`${path.relative(publicDir, fullPath).replaceAll(path.sep, '/')}: ${Math.round(size / 1024)} KB`);
    }
  }
}

walk(publicDir);

if (failures.length > 0) {
  console.error(`Image asset budget exceeded (${maxImageBytes / 1024} KB):\n${failures.join('\n')}`);
  process.exit(1);
}

console.log(`Image asset budget passed: all raster assets are <= ${maxImageBytes / 1024} KB.`);
