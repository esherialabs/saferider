import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..');
const magick = process.env.IMAGEMAGICK_BIN || 'magick';

const iconSource = 'assets/adaptive-icon.png';
const monochromeSource = 'assets/adaptive-icon-monochrome.png';
const splashSource = 'assets/splash-icon.png';

const launcherSizes = {
  mdpi: 48,
  hdpi: 72,
  xhdpi: 96,
  xxhdpi: 144,
  xxxhdpi: 192,
};

const adaptiveForegroundSizes = {
  mdpi: 108,
  hdpi: 162,
  xhdpi: 216,
  xxhdpi: 324,
  xxxhdpi: 432,
};

const splashSizes = {
  mdpi: 288,
  hdpi: 432,
  xhdpi: 576,
  xxhdpi: 864,
  xxxhdpi: 1152,
};

function assertFile(path) {
  if (!existsSync(resolve(repoRoot, path))) {
    throw new Error(`Missing logo source: ${path}`);
  }
}

function runMagick(args) {
  execFileSync(magick, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    windowsHide: true,
  });
}

function writeWebp(source, output, size) {
  runMagick([
    source,
    '-resize',
    `${size}x${size}`,
    '-strip',
    '-depth',
    '8',
    '-define',
    'webp:lossless=true',
    `WEBP:${output}`,
  ]);
}

function writePng(source, output, size) {
  runMagick([
    source,
    '-resize',
    `${size}x${size}`,
    '-strip',
    '-depth',
    '8',
    `PNG32:${output}`,
  ]);
}

function writeMonochromeSource(source, output) {
  runMagick([
    source,
    '-fuzz',
    '8%',
    '-transparent',
    '#FFF8F3',
    '-alpha',
    'extract',
    '-threshold',
    '1%',
    '-write',
    'mpr:mask',
    '+delete',
    '-size',
    '1024x1024',
    'xc:white',
    'mpr:mask',
    '-compose',
    'copyopacity',
    '-composite',
    '-strip',
    `PNG32:${output}`,
  ]);
}

assertFile(iconSource);
assertFile(splashSource);
writeMonochromeSource(iconSource, monochromeSource);

for (const [density, size] of Object.entries(launcherSizes)) {
  const base = `android/app/src/main/res/mipmap-${density}`;
  writeWebp(iconSource, `${base}/ic_launcher.webp`, size);
  writeWebp(iconSource, `${base}/ic_launcher_round.webp`, size);
}

for (const [density, size] of Object.entries(adaptiveForegroundSizes)) {
  writeWebp(iconSource, `android/app/src/main/res/mipmap-${density}/ic_launcher_foreground.webp`, size);
  writeWebp(monochromeSource, `android/app/src/main/res/mipmap-${density}/ic_launcher_monochrome.webp`, size);
}

for (const [density, size] of Object.entries(splashSizes)) {
  writePng(splashSource, `android/app/src/main/res/drawable-${density}/splashscreen_logo.png`, size);
}

console.log('Android launcher and splash logo resources now match Expo logo sources.');
