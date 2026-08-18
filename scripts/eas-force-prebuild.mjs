import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.EAS_BUILD !== 'true') {
  console.log('Skipping native prebuild cleanup outside EAS Build.');
  process.exit(0);
}

for (const dir of ['android', 'ios']) {
  const nativePath = resolve(dir);
  if (!existsSync(nativePath)) continue;
  rmSync(nativePath, { recursive: true, force: true });
  console.log(`Removed ${dir}/ so EAS can regenerate native code from Expo config.`);
}
