#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withNpx = process.argv.includes('--with-npx');

function run(command, args = [], options = {}) {
  const useShell = process.platform === 'win32';
  const commandLine = [command, ...args].map(quoteShellArg).join(' ');
  const result = spawnSync(useShell ? commandLine : command, useShell ? [] : args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: useShell,
    timeout: options.timeoutMs ?? 15_000,
  });

  if (result.error) {
    return {
      ok: false,
      missing: result.error.code === 'ENOENT',
      text: result.error.message,
    };
  }

  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\0/g, '').trim();
  return {
    ok: result.status === 0,
    status: result.status,
    text,
  };
}

function quoteShellArg(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(text)) return text;
  return `"${text.replace(/"/g, '\\"')}"`;
}

function firstLine(text) {
  return text.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? '';
}

function exists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function readText(relativePath) {
  const target = path.join(repoRoot, relativePath);
  return fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
}

function commandVersion(label, command, args, options = {}) {
  const result = run(command, args, options);
  return {
    label,
    ok: result.ok,
    detail: result.ok ? firstLine(result.text) : 'missing or not runnable',
  };
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

function printStatus(ok, label, detail = '') {
  const marker = ok ? '[ok]' : '[blocked]';
  console.log(`${marker} ${label}${detail ? `: ${detail}` : ''}`);
}

function envPathStatus(name) {
  const value = process.env[name];
  if (!value) {
    return { ok: false, detail: 'not set' };
  }
  return {
    ok: fs.existsSync(value),
    detail: `${value} (${fs.existsSync(value) ? 'exists' : 'path not found'})`,
  };
}

function resolveAndroidSdkRoot() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === 'win32' && process.env.LOCALAPPDATA
      ? path.join(process.env.LOCALAPPDATA, 'Android', 'Sdk')
      : undefined,
    process.platform !== 'win32' ? path.join(os.homedir(), 'Android', 'Sdk') : undefined,
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0];
}

function prependPathEntries(entries) {
  const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH';
  const currentValue = process.env[pathKey] ?? '';
  const currentEntries = currentValue.split(path.delimiter).filter(Boolean);
  const normalized = new Set(currentEntries.map(entry => entry.toLowerCase()));
  const nextEntries = [];
  for (const entry of entries) {
    if (entry && fs.existsSync(entry) && !normalized.has(entry.toLowerCase())) {
      nextEntries.push(entry);
    }
  }
  process.env[pathKey] = [...nextEntries, ...currentEntries].join(path.delimiter);
}

function listInstalledAndroidSystemImages(sdkRoot) {
  if (!sdkRoot) return [];
  const systemImagesRoot = path.join(sdkRoot, 'system-images');
  if (!fs.existsSync(systemImagesRoot)) return [];
  const results = [];
  for (const apiLevel of fs.readdirSync(systemImagesRoot)) {
    const apiPath = path.join(systemImagesRoot, apiLevel);
    if (!fs.statSync(apiPath).isDirectory()) continue;
    for (const vendor of fs.readdirSync(apiPath)) {
      const vendorPath = path.join(apiPath, vendor);
      if (!fs.statSync(vendorPath).isDirectory()) continue;
      for (const abi of fs.readdirSync(vendorPath)) {
        const abiPath = path.join(vendorPath, abi);
        if (fs.statSync(abiPath).isDirectory() && fs.existsSync(path.join(abiPath, 'source.properties'))) {
          results.push(`${apiLevel}/${vendor}/${abi}`);
        }
      }
    }
  }
  return results;
}

function listAttachedAndroidDevices() {
  const result = run('adb', ['devices', '-l'], { timeoutMs: 30_000 });
  if (!result.ok) {
    return {
      ok: false,
      physicalCount: 0,
      detail: 'adb not runnable',
    };
  }
  const attached = result.text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^\S+\s+device\b/.test(line));
  const physicalCount = attached.filter(line => !line.startsWith('emulator-')).length;
  const emulatorCount = attached.length - physicalCount;
  const parts = [];
  if (physicalCount > 0) parts.push(`${physicalCount} physical`);
  if (emulatorCount > 0) parts.push(`${emulatorCount} emulator`);
  return {
    ok: physicalCount > 0,
    physicalCount,
    detail: parts.length > 0 ? `${parts.join(', ')} attached` : 'none attached',
  };
}

function listConfiguredAndroidAvds() {
  const avdManagerResult = run('avdmanager', ['list', 'avd'], { timeoutMs: 60_000 });
  const avdManagerNames = avdManagerResult.ok
    ? [...avdManagerResult.text.matchAll(/^\s*Name:\s*(\S+)/gm)].map(match => match[1])
    : [];

  const emulatorResult = run('emulator', ['-list-avds'], { timeoutMs: 30_000 });
  const emulatorNames = emulatorResult.ok
    ? emulatorResult.text
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
    : [];

  return [...new Set([...avdManagerNames, ...emulatorNames])];
}

function parseModelBlock(source, constName) {
  const marker = `export const ${constName}`;
  const start = source.indexOf(marker);
  if (start === -1) return null;
  const assignmentStart = source.indexOf('=', start);
  if (assignmentStart === -1) return null;
  const afterAssignment = source.slice(assignmentStart + 1).match(/\S/);
  if (!afterAssignment || afterAssignment[0] !== '{') return null;
  const objectStart = assignmentStart + 1 + afterAssignment.index;
  return extractObjectLiteral(source, objectStart);
}

function extractObjectLiteral(source, objectStart) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '\'' || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(objectStart, index + 1);
    }
  }
  return null;
}

function parseLocalModelFromBlock(block) {
  const id = block.match(/id: '([^']+)'/)?.[1];
  const fileName = block.match(/modelFileName: '([^']+)'/)?.[1];
  const storageDir = block.match(/storageDir: '([^']+)'/)?.[1];
  const sizeRaw = block.match(/approximateSizeBytes: ([0-9_]+)/)?.[1];
  const sizeBytes = sizeRaw ? Number(sizeRaw.replace(/_/g, '')) : undefined;
  const artifactState = block.match(/state: '([^']+)'/)?.[1];
  return { id, fileName, storageDir, sizeBytes, artifactState };
}

function parseManifestBackedModel(registrySource, configConstName) {
  const manifestConstName = registrySource.match(
    new RegExp(`export const ${configConstName}\\s*=\\s*localModelConfigFromManifest\\(\\s*([A-Z0-9_]+)`),
  )?.[1];
  if (!manifestConstName) return null;

  const manifestSource = readText('src/lib/localAssistant/modelManifest.ts');
  if (!manifestSource) return null;
  const manifestBlock = parseModelBlock(manifestSource, manifestConstName);
  if (!manifestBlock) return null;

  const manifestId = manifestBlock.match(/manifestId: '([^']+)'/)?.[1];
  const id = manifestBlock.match(/modelId: '([^']+)'/)?.[1];
  const runtimeKind = manifestBlock.match(/runtime:\s*{[\s\S]*?kind: '([^']+)'/)?.[1];
  const artifactBlock = manifestBlock.match(/artifacts:\s*\[\s*({[\s\S]*?})\s*,?\s*\]/)?.[1] ?? manifestBlock;
  const fileName = artifactBlock.match(/fileName: '([^']+)'/)?.[1];
  const sizeRaw = artifactBlock.match(/sizeBytes: ([0-9_]+)/)?.[1];
  const sizeBytes = sizeRaw ? Number(sizeRaw.replace(/_/g, '')) : undefined;
  const storageDir = manifestId ? `manifests/${manifestId}` : undefined;
  const controlledImportOnly = /controlledImportOnly:\s*true/.test(artifactBlock);
  const downloadMode = manifestBlock.match(/rollout:\s*{[\s\S]*?downloadMode: '([^']+)'/)?.[1];
  const artifactState =
    runtimeKind === 'litert-lm' && (controlledImportOnly || downloadMode !== 'app-download')
      ? 'runtime-pending'
      : 'app-ready';

  return { id, fileName, storageDir, sizeBytes, artifactState };
}

function parseDefaultLocalModel() {
  const registryPath = path.join(repoRoot, 'src/lib/localAssistant/modelRegistry.ts');
  if (!fs.existsSync(registryPath)) return null;
  const source = fs.readFileSync(registryPath, 'utf8');
  const defaultConstName = source.match(/DEFAULT_LOCAL_MODEL_ID\s*=\s*([A-Z0-9_]+)\.id/)?.[1];
  const block = defaultConstName ? parseModelBlock(source, defaultConstName) : null;
  if (block) return parseLocalModelFromBlock(block);
  if (defaultConstName) {
    const manifestBackedModel = parseManifestBackedModel(source, defaultConstName);
    if (manifestBackedModel) return manifestBackedModel;
  }
  return parseLocalModelFromBlock(source);
}

const appConfig = readJson('app.json').expo;
const easConfig = readJson('eas.json');
const packageJson = readJson('package.json');
const androidSdkRoot = resolveAndroidSdkRoot();
if (androidSdkRoot) {
  process.env.ANDROID_HOME = process.env.ANDROID_HOME || androidSdkRoot;
  process.env.ANDROID_SDK_ROOT = process.env.ANDROID_SDK_ROOT || androidSdkRoot;
  prependPathEntries([
    path.join(androidSdkRoot, 'platform-tools'),
    path.join(androidSdkRoot, 'emulator'),
    path.join(androidSdkRoot, 'cmdline-tools', 'latest', 'bin'),
  ]);
}
const tools = [
  commandVersion('Node', 'node', ['--version']),
  commandVersion('npm', 'npm', ['--version']),
  commandVersion('Git', 'git', ['--version']),
  commandVersion('GitHub CLI', 'gh', ['--version'], { timeoutMs: 60_000 }),
  commandVersion('Java', 'java', ['-version'], { timeoutMs: 30_000 }),
  commandVersion('ADB', 'adb', ['version'], { timeoutMs: 30_000 }),
  commandVersion('Android emulator', 'emulator', ['-version'], { timeoutMs: 30_000 }),
  commandVersion('Android sdkmanager', 'sdkmanager', ['--version'], { timeoutMs: 60_000 }),
  commandVersion('Android avdmanager', 'avdmanager', ['list', 'avd'], { timeoutMs: 60_000 }),
  commandVersion('Gradle', 'gradle', ['--version'], { timeoutMs: 5_000 }),
  commandVersion('WSL', 'wsl', ['--version'], { timeoutMs: 10_000 }),
  commandVersion('EAS CLI', 'eas', ['--version'], { timeoutMs: 5_000 }),
  commandVersion('Expo CLI', 'expo', ['--version'], { timeoutMs: 10_000 }),
];
const installedAndroidSystemImages = listInstalledAndroidSystemImages(androidSdkRoot);
const configuredAndroidAvds = listConfiguredAndroidAvds();
const hasAndroidAvd = configuredAndroidAvds.length > 0;
const attachedAndroidDevices = listAttachedAndroidDevices();

if (process.platform === 'darwin') {
  tools.push(commandVersion('Xcode', 'xcodebuild', ['-version']));
  tools.push(commandVersion('CocoaPods', 'pod', ['--version']));
}

if (withNpx) {
  tools.push(commandVersion('Expo via npx', 'npx', ['expo', '--version'], { timeoutMs: 90_000 }));
  tools.push(commandVersion('EAS via npx', 'npx', ['eas-cli', '--version'], { timeoutMs: 90_000 }));
}

console.log('SafeRide Mobile Test Environment Check');
console.log(`Repo: ${repoRoot}`);
console.log(`Host: ${os.type()} ${os.release()} ${os.arch()}`);
console.log('No builds, downloads, emulator launches, installs, Docker, AWS, or store actions are run by this script.');

printSection('Repo Configuration');
printStatus(exists('app.json'), 'Expo app config', 'app.json');
printStatus(exists('app.config.js'), 'Expo runtime config guard', 'app.config.js');
printStatus(exists('eas.json'), 'EAS config', 'eas.json');
printStatus(exists('android/gradlew.bat') || exists('android/gradlew'), 'Android Gradle wrapper', 'android/gradlew(.bat)');
printStatus(exists('ios/Podfile'), 'iOS native project', 'ios/Podfile');
printStatus(exists('node_modules'), 'Mobile dependencies installed', 'node_modules');
printStatus(exists('apps/api/node_modules'), 'API dependencies installed', 'apps/api/node_modules');

printSection('App Identity');
console.log(`Name: ${appConfig.name}`);
console.log(`Version: ${appConfig.version}`);
console.log(`Android package: ${appConfig.android?.package ?? 'missing'}`);
console.log(`iOS bundle id: ${appConfig.ios?.bundleIdentifier ?? 'missing'}`);
console.log(`EAS owner: ${appConfig.owner ?? 'missing'}`);
console.log(`EAS project id: ${appConfig.extra?.eas?.projectId ?? 'missing'}`);
console.log(`EAS build profiles: ${Object.keys(easConfig.build ?? {}).join(', ')}`);
console.log(`Package scripts include release preflight: ${Boolean(packageJson.scripts?.['release:preflight'])}`);

printSection('Tooling');
for (const tool of tools) {
  printStatus(tool.ok, tool.label, tool.detail);
}

printSection('SDK Paths');
for (const name of ['JAVA_HOME', 'ANDROID_HOME', 'ANDROID_SDK_ROOT']) {
  const status = envPathStatus(name);
  printStatus(status.ok, name, status.detail);
}
printStatus(
  installedAndroidSystemImages.length > 0,
  'Android system images',
  installedAndroidSystemImages.length > 0 ? installedAndroidSystemImages.join(', ') : 'none installed',
);
printStatus(
  hasAndroidAvd,
  'Android Virtual Device',
  hasAndroidAvd ? configuredAndroidAvds.join(', ') : 'none configured',
);
printStatus(attachedAndroidDevices.ok, 'Attached Android device state', attachedAndroidDevices.detail);

printSection('Local Assistant Model');
const model = parseDefaultLocalModel();
if (model) {
  console.log(`Default model id: ${model.id ?? 'unknown'}`);
  console.log(`Model file: ${model.fileName ?? 'unknown'}`);
  console.log(`Storage dir: ${model.storageDir ?? 'unknown'}`);
  console.log(`Approx size: ${model.sizeBytes ? `${model.sizeBytes} bytes` : 'unknown'}`);
  console.log(`Artifact state: ${model.artifactState ?? 'unknown'}`);
} else {
  printStatus(false, 'Model registry', 'src/lib/localAssistant/modelRegistry.ts not found');
}

const hasJava = tools.find(tool => tool.label === 'Java')?.ok;
const hasAdb = tools.find(tool => tool.label === 'ADB')?.ok;
const hasSdkManager = tools.find(tool => tool.label === 'Android sdkmanager')?.ok;
const hasEmulator = tools.find(tool => tool.label === 'Android emulator')?.ok;
const hasAndroidHome = Boolean(process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT);
const hasSystemImage = installedAndroidSystemImages.length > 0;
const hasEas = tools.find(tool => tool.label === 'EAS CLI')?.ok || tools.find(tool => tool.label === 'EAS via npx')?.ok;

printSection('Capability Summary');
printStatus(Boolean(hasJava && hasAndroidHome && hasSdkManager), 'Local Android native build setup', 'requires JDK + Android SDK cmdline tools');
printStatus(
  Boolean(hasAdb && attachedAndroidDevices.physicalCount > 0),
  'Physical Android install/logcat testing',
  'requires platform-tools/adb and an attached USB-debuggable physical device',
);
printStatus(Boolean(hasEmulator && hasSystemImage && hasAndroidAvd), 'Android emulator UI testing', 'requires emulator + system image + AVD');
printStatus(Boolean(hasEas), 'EAS CLI access', withNpx ? 'npx check enabled' : 'global EAS only checked; run npm run mobile:env-check:npx for transient npx check');
printStatus(process.platform === 'darwin', 'Local iOS simulator/device build', 'requires macOS, Xcode, CocoaPods, and Apple signing context');
printStatus(Boolean(model?.fileName?.endsWith('.litertlm')), 'Gemma 4 LiteRT-LM registry wiring', 'requires the default model to use the .litertlm artifact');

printSection('Next Commands');
console.log('npm run mobile:env-check:npx');
console.log('npm run ai:gemma4:artifact:check');
console.log('npm run ai:gemma4:preseed:target');
console.log('npm run release:preflight');
console.log('npx expo-doctor');
console.log('npx eas-cli build:list --platform android --limit 5 --non-interactive');
