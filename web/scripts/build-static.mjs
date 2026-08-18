import { spawnSync } from 'node:child_process';
import path from 'node:path';

const command = path.join(
  process.cwd(),
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'next.cmd' : 'next',
);

const result = spawnSync(command, ['build'], {
  env: {
    ...process.env,
    NEXT_OUTPUT: 'export',
  },
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) {
  console.error(result.error);
}

process.exit(result.status ?? 1);
