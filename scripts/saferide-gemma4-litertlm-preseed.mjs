#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultManifestPath = path.join(
  repoRoot,
  'config/ai/manifests/saferide-v058-original-419806.artifact-produced.json',
);
const appJsonPath = path.join(repoRoot, 'app.json');
const oneGiB = 1024 * 1024 * 1024;

function usage() {
  return `
Usage:
  node scripts/saferide-gemma4-litertlm-preseed.mjs --artifact <path> [--device <serial>] [--package <id>]
  node scripts/saferide-gemma4-litertlm-preseed.mjs --artifact <path> --check-only
  node scripts/saferide-gemma4-litertlm-preseed.mjs --print-target [--package <id>]

Options:
  --artifact <path>   Local path to the exact .litertlm file. The script never downloads it.
  --manifest <path>   Structured tuned-artifact manifest JSON. Defaults to the bundled v0.5.8 manifest.
  --device <serial>   adb device serial. Required when multiple devices are attached.
  --package <id>      Android package id. Defaults to app.json expo.android.package.
  --check-only        Validate local artifact metadata only; do not call adb.
  --print-target      Print the app-internal target path and exit.
  --require-arm64     Fail if the selected device ABI is not arm64-v8a.
  --help              Show this help.
`.trim();
}

function parseArgs(argv) {
  const args = {
    artifactPath: process.env.SAFERIDE_GEMMA4_LITERTLM_ARTIFACT,
    manifestPath: defaultManifestPath,
    device: undefined,
    packageName: undefined,
    checkOnly: false,
    printTarget: false,
    requireArm64: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--artifact') {
      args.artifactPath = argv[++index];
    } else if (arg === '--manifest') {
      args.manifestPath = argv[++index];
    } else if (arg === '--device') {
      args.device = argv[++index];
    } else if (arg === '--package') {
      args.packageName = argv[++index];
    } else if (arg === '--check-only') {
      args.checkOnly = true;
    } else if (arg === '--print-target') {
      args.printTarget = true;
    } else if (arg === '--require-arm64') {
      args.requireArm64 = true;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function appPackageName() {
  const appJson = JSON.parse(readText(appJsonPath));
  const packageName = appJson.expo?.android?.package;
  if (!packageName) {
    throw new Error('Unable to read expo.android.package from app.json.');
  }
  return packageName;
}

function parseManifest(manifestPath) {
  let payload;
  try {
    payload = JSON.parse(readText(path.resolve(manifestPath)));
  } catch (error) {
    throw new Error(`Unable to read tuned artifact manifest JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const artifact = payload?.artifact;
  const manifest = {
    manifestId: payload?.manifestId,
    modelId: payload?.modelId,
    status: payload?.status,
    fileName: artifact?.fileName,
    sha256: typeof artifact?.sha256 === 'string' ? artifact.sha256.toLowerCase() : artifact?.sha256,
    sizeBytes: artifact?.sizeBytes,
  };
  if (payload?.schema !== 'com.saferide.tuned-mobile-artifact-manifest') {
    throw new Error('Unsupported tuned artifact manifest schema.');
  }
  if (!['artifact-produced', 'artifact-android-verified', 'checkpoint-candidate', 'release-candidate', 'release-ready'].includes(manifest.status)) {
    throw new Error('The tuned artifact manifest does not contain a produced artifact.');
  }
  if (typeof manifest.manifestId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(manifest.manifestId)) {
    throw new Error('The tuned artifact manifestId is invalid.');
  }
  if (typeof manifest.modelId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\/[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(manifest.modelId)) {
    throw new Error('The tuned artifact modelId is invalid.');
  }
  if (typeof manifest.fileName !== 'string' || !manifest.fileName.endsWith('.litertlm')) {
    throw new Error('The tuned artifact fileName is invalid.');
  }
  if (typeof manifest.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifest.sha256)) {
    throw new Error('The tuned artifact SHA-256 is invalid.');
  }
  if (!Number.isSafeInteger(manifest.sizeBytes) || manifest.sizeBytes <= 0) {
    throw new Error('The tuned artifact sizeBytes is invalid.');
  }
  return manifest;
}

function modelRelativePath(manifest) {
  return `models/manifests/${manifest.manifestId}/${manifest.fileName}`;
}

function androidShellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 30_000,
  });
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (result.error) {
    throw new Error(`${command} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(text || `${command} exited with ${result.status}`);
  }
  return text;
}

function adbArgs(device, args) {
  return device ? ['-s', device, ...args] : args;
}

function runAdb(device, args, options = {}) {
  return run('adb', adbArgs(device, args), options);
}

function runAs(device, packageName, shellCommand, options = {}) {
  return runAdb(device, ['shell', 'run-as', packageName, 'sh', '-c', shellCommand], options);
}

function parseAttachedDevices(text) {
  return text
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => /^\S+\s+device\b/.test(line))
    .map(line => {
      const [serial] = line.split(/\s+/);
      return {
        serial,
        emulator: serial.startsWith('emulator-'),
      };
    });
}

function selectDevice(requestedSerial) {
  const devices = parseAttachedDevices(run('adb', ['devices', '-l'], { timeoutMs: 30_000 }));
  if (requestedSerial) {
    const selected = devices.find(device => device.serial === requestedSerial);
    if (!selected) {
      throw new Error(`adb device ${requestedSerial} is not attached and ready.`);
    }
    return selected;
  }
  if (devices.length === 0) {
    throw new Error('No adb device is attached. Start an emulator or attach a USB-debuggable Android device.');
  }
  if (devices.length > 1) {
    throw new Error(`Multiple adb devices are attached (${devices.map(device => device.serial).join(', ')}). Pass --device <serial>.`);
  }
  return devices[0];
}

function parseDataFreeBytes(dfOutput) {
  const lines = dfOutput.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  const dataLine = lines.find(line => /\s\/data(?:\/|$)/.test(line) || line.endsWith(' /data'));
  if (!dataLine) return undefined;
  const parts = dataLine.split(/\s+/);
  const availableKb = Number(parts[3]);
  return Number.isFinite(availableKb) ? availableKb * 1024 : undefined;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function validateArtifact(artifactPath, manifest) {
  if (!artifactPath) {
    throw new Error('Pass --artifact <path> or set SAFERIDE_GEMMA4_LITERTLM_ARTIFACT.');
  }
  const resolvedPath = path.resolve(artifactPath);
  const stat = fs.existsSync(resolvedPath) ? fs.statSync(resolvedPath) : null;
  if (!stat?.isFile()) {
    throw new Error(`Artifact file not found: ${resolvedPath}`);
  }
  if (path.basename(resolvedPath) !== manifest.fileName) {
    throw new Error(`Artifact file name must be ${manifest.fileName}.`);
  }
  if (stat.size !== manifest.sizeBytes) {
    throw new Error(`Artifact size mismatch. Expected ${manifest.sizeBytes} bytes, found ${stat.size} bytes.`);
  }
  const digest = await sha256File(resolvedPath);
  if (digest.toLowerCase() !== manifest.sha256) {
    throw new Error(`Artifact SHA-256 mismatch. Expected ${manifest.sha256}, found ${digest.toLowerCase()}.`);
  }
  return {
    path: resolvedPath,
    sizeBytes: stat.size,
    sha256: digest.toLowerCase(),
  };
}

function streamFileToRunAs({ artifactPath, device, packageName, targetRelativePath }) {
  return new Promise((resolve, reject) => {
    const targetDirectory = path.posix.dirname(targetRelativePath);
    const tempRelativePath = `${targetRelativePath}.tmp`;
    const command = [
      `mkdir -p ${androidShellQuote(targetDirectory)}`,
      `rm -f ${androidShellQuote(tempRelativePath)}`,
      `cat > ${androidShellQuote(tempRelativePath)}`,
    ].join(' && ');
    const child = spawn('adb', adbArgs(device, ['exec-in', 'run-as', packageName, 'sh', '-c', command]), {
      cwd: repoRoot,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const input = fs.createReadStream(artifactPath);
    let stderr = '';
    let sentBytes = 0;
    let lastProgressAt = 0;

    child.stderr.on('data', chunk => {
      stderr += chunk.toString('utf8');
    });
    child.stdout.resume();
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `adb exec-in exited with ${code}`));
      }
    });
    input.on('data', chunk => {
      sentBytes += chunk.length;
      if (sentBytes - lastProgressAt >= 256 * 1024 * 1024) {
        lastProgressAt = sentBytes;
        console.log(`Streamed ${Math.floor(sentBytes / (1024 * 1024))} MB...`);
      }
    });
    input.on('error', error => {
      child.stdin.destroy(error);
      reject(error);
    });
    input.pipe(child.stdin);
  });
}

async function preseedArtifact({ artifact, device, packageName, manifest, requireArm64 }) {
  const selected = selectDevice(device);
  const abi = runAdb(selected.serial, ['shell', 'getprop', 'ro.product.cpu.abi'], { timeoutMs: 30_000 }).trim();
  const androidVersion = runAdb(selected.serial, ['shell', 'getprop', 'ro.build.version.release'], { timeoutMs: 30_000 }).trim();
  const model = runAdb(selected.serial, ['shell', 'getprop', 'ro.product.model'], { timeoutMs: 30_000 }).trim();
  if (requireArm64 && abi !== 'arm64-v8a') {
    throw new Error(`Selected device ABI is ${abi}; --require-arm64 needs arm64-v8a.`);
  }

  const appRoot = runAs(selected.serial, packageName, 'pwd', { timeoutMs: 30_000 }).split(/\r?\n/)[0]?.trim();
  if (!appRoot || !appRoot.startsWith('/data/')) {
    throw new Error(`Package ${packageName} is not available to run-as. Install a debuggable SafeRide Android build first.`);
  }

  const freeBytes = parseDataFreeBytes(runAdb(selected.serial, ['shell', 'df', '-k', '/data'], { timeoutMs: 30_000 }));
  if (freeBytes !== undefined && freeBytes < manifest.sizeBytes + oneGiB) {
    throw new Error(
      `Device /data free space is too low. Need at least ${manifest.sizeBytes + oneGiB} bytes; found ${freeBytes} bytes.`,
    );
  }

  const targetRelativePath = `files/${modelRelativePath(manifest)}`;
  const tempRelativePath = `${targetRelativePath}.tmp`;
  const targetPath = `${appRoot}/${targetRelativePath}`;
  console.log(`Selected device: ${selected.serial}${selected.emulator ? ' (emulator; not final physical proof)' : ''}`);
  console.log(`Android: ${androidVersion || 'unknown'}, ABI: ${abi || 'unknown'}, model: ${model || 'unknown'}`);
  console.log(`Target: file://${targetPath}`);
  console.log('Streaming artifact into app-controlled storage...');
  await streamFileToRunAs({
    artifactPath: artifact.path,
    device: selected.serial,
    packageName,
    targetRelativePath,
  });

  runAs(
    selected.serial,
    packageName,
    [
      `mv -f ${androidShellQuote(tempRelativePath)} ${androidShellQuote(targetRelativePath)}`,
      `chmod 600 ${androidShellQuote(targetRelativePath)}`,
    ].join(' && '),
    { timeoutMs: 30_000 },
  );

  const deviceSize = Number(runAs(
    selected.serial,
    packageName,
    `wc -c < ${androidShellQuote(targetRelativePath)}`,
    { timeoutMs: 60_000 },
  ).trim());
  if (deviceSize !== manifest.sizeBytes) {
    throw new Error(`Device artifact size mismatch. Expected ${manifest.sizeBytes} bytes, found ${deviceSize} bytes.`);
  }

  const deviceSha = runAs(
    selected.serial,
    packageName,
    `sha256sum ${androidShellQuote(targetRelativePath)} | cut -d ' ' -f 1`,
    { timeoutMs: 900_000 },
  ).trim().toLowerCase();
  if (deviceSha !== manifest.sha256) {
    throw new Error(`Device artifact SHA-256 mismatch. Expected ${manifest.sha256}, found ${deviceSha}.`);
  }

  console.log('Preseed complete: device file size and SHA-256 match the approved manifest.');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }

  const manifest = parseManifest(args.manifestPath);
  const packageName = args.packageName ?? appPackageName();
  const targetPath = `/data/user/0/${packageName}/files/${modelRelativePath(manifest)}`;

  console.log('SafeRide Gemma 4 E2B LiteRT-LM preseed');
  console.log(`Model id: ${manifest.modelId}`);
  console.log(`Manifest id: ${manifest.manifestId}`);
  console.log(`Expected file: ${manifest.fileName}`);
  console.log(`Expected size: ${manifest.sizeBytes} bytes`);
  console.log(`Expected SHA-256: ${manifest.sha256}`);
  console.log('Network downloads: disabled');

  if (args.printTarget) {
    console.log(`App-internal target: file://${targetPath}`);
    return;
  }

  const artifact = await validateArtifact(args.artifactPath, manifest);
  console.log(`Local artifact verified: ${artifact.sizeBytes} bytes, SHA-256 match.`);
  if (args.checkOnly) {
    return;
  }

  await preseedArtifact({
    artifact,
    device: args.device,
    packageName,
    manifest,
    requireArm64: args.requireArm64,
  });
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(`\n${usage()}`);
  process.exitCode = 1;
});
