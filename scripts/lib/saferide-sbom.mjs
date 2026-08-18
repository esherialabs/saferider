import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SBOM_PATH = 'docs/security/sbom/saferide-source-dependencies.cdx.json';

export const WORKSPACES = Object.freeze([
  { id: 'mobile', packagePath: 'package.json', lockPath: 'package-lock.json' },
  { id: 'api', packagePath: 'apps/api/package.json', lockPath: 'apps/api/package-lock.json' },
  { id: 'web', packagePath: 'web/package.json', lockPath: 'web/package-lock.json' },
]);

export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex');
}

export function sha256File(filePath) {
  return sha256Bytes(fs.readFileSync(filePath));
}

function readJson(rootDir, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function packageNameFromPath(packagePath) {
  const marker = 'node_modules/';
  const index = packagePath.lastIndexOf(marker);
  if (index < 0) return null;
  const tail = packagePath.slice(index + marker.length);
  const parts = tail.split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function packagePurl(name, version) {
  const encoded = name.startsWith('@')
    ? `%40${name.slice(1).split('/').map(encodeURIComponent).join('/')}`
    : encodeURIComponent(name);
  return `pkg:npm/${encoded}@${encodeURIComponent(version)}`;
}

function componentRef(workspace, packagePath, name, version) {
  return `urn:saferide:npm:${workspace}:${encodeURIComponent(packagePath)}:${encodeURIComponent(name)}@${encodeURIComponent(version)}`;
}

function integrityHashes(integrity) {
  if (typeof integrity !== 'string') return [];
  return integrity.split(/\s+/).flatMap(item => {
    const separator = item.indexOf('-');
    if (separator < 1) return [];
    const algorithm = item.slice(0, separator).toLowerCase();
    if (!['sha256', 'sha384', 'sha512'].includes(algorithm)) return [];
    try {
      return [{
        alg: algorithm.toUpperCase().replace('SHA', 'SHA-'),
        content: Buffer.from(item.slice(separator + 1), 'base64').toString('hex'),
      }];
    } catch {
      return [];
    }
  });
}

function packageProperties(workspace, packagePath, entry) {
  return [
    { name: 'saferide:workspace', value: workspace },
    { name: 'saferide:lock-path', value: packagePath },
    { name: 'saferide:development-only', value: String(Boolean(entry.dev)) },
    { name: 'saferide:optional', value: String(Boolean(entry.optional)) },
  ];
}

function makeComponent(workspace, packagePath, entry) {
  const name = entry.name ?? packageNameFromPath(packagePath);
  if (!name || !entry.version) {
    throw new Error(`${workspace}:${packagePath}: package name and version are required`);
  }
  const component = {
    type: 'library',
    'bom-ref': componentRef(workspace, packagePath, name, entry.version),
    name,
    version: entry.version,
    purl: packagePurl(name, entry.version),
    properties: packageProperties(workspace, packagePath, entry),
  };
  const hashes = integrityHashes(entry.integrity);
  if (hashes.length > 0) component.hashes = hashes;
  if (entry.license) component.licenses = [{ expression: entry.license }];
  if (entry.resolved) {
    component.externalReferences = [{ type: 'distribution', url: entry.resolved }];
  }
  return component;
}

function parentPackagePaths(packagePath) {
  const parents = [packagePath];
  let cursor = packagePath;
  while (cursor.includes('/node_modules/')) {
    cursor = cursor.slice(0, cursor.lastIndexOf('/node_modules/'));
    parents.push(cursor);
  }
  parents.push('');
  return [...new Set(parents)];
}

function resolveDependencyPath(packages, fromPath, dependencyName) {
  for (const parent of parentPackagePaths(fromPath)) {
    const candidate = parent ? `${parent}/node_modules/${dependencyName}` : `node_modules/${dependencyName}`;
    if (packages[candidate]) return candidate;
  }
  return null;
}

function dependencyNames(entry) {
  return [...new Set([
    ...Object.keys(entry.dependencies ?? {}),
    ...Object.keys(entry.optionalDependencies ?? {}),
  ])].sort();
}

function makeWorkspace(rootDir, definition) {
  const packageJson = readJson(rootDir, definition.packagePath);
  const lock = readJson(rootDir, definition.lockPath);
  if (lock.lockfileVersion !== 3 || !lock.packages || typeof lock.packages !== 'object') {
    throw new Error(`${definition.lockPath}: lockfileVersion 3 with packages is required`);
  }

  const components = [];
  const refsByPath = new Map();
  for (const [packagePath, entry] of Object.entries(lock.packages).sort(([left], [right]) => left.localeCompare(right))) {
    if (!packagePath) continue;
    const component = makeComponent(definition.id, packagePath, entry);
    components.push(component);
    refsByPath.set(packagePath, component['bom-ref']);
  }

  const rootRef = `urn:saferide:workspace:${definition.id}`;
  const dependencies = [];
  const rootDependencies = dependencyNames(lock.packages[''] ?? {})
    .map(name => resolveDependencyPath(lock.packages, '', name))
    .filter(Boolean)
    .map(packagePath => refsByPath.get(packagePath))
    .filter(Boolean)
    .sort();
  dependencies.push({ ref: rootRef, dependsOn: [...new Set(rootDependencies)] });

  for (const [packagePath, entry] of Object.entries(lock.packages).sort(([left], [right]) => left.localeCompare(right))) {
    if (!packagePath) continue;
    const dependsOn = dependencyNames(entry)
      .map(name => resolveDependencyPath(lock.packages, packagePath, name))
      .filter(Boolean)
      .map(resolvedPath => refsByPath.get(resolvedPath))
      .filter(Boolean)
      .sort();
    dependencies.push({ ref: refsByPath.get(packagePath), dependsOn: [...new Set(dependsOn)] });
  }

  return {
    application: {
      type: 'application',
      'bom-ref': rootRef,
      name: packageJson.name,
      version: packageJson.version,
      properties: [
        { name: 'saferide:workspace', value: definition.id },
        { name: 'saferide:lockfile', value: definition.lockPath },
        { name: 'saferide:lockfile-sha256', value: sha256File(path.join(rootDir, definition.lockPath)) },
      ],
    },
    components,
    dependencies,
  };
}

function uuidFromHex(hex) {
  const bytes = hex.slice(0, 32).split('');
  bytes[12] = '5';
  bytes[16] = (8 + (Number.parseInt(bytes[16], 16) % 4)).toString(16);
  const value = bytes.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

export function buildSourceSbom(rootDir) {
  const workspaces = WORKSPACES.map(definition => makeWorkspace(rootDir, definition));
  const base = {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    metadata: {
      lifecycles: [{ phase: 'build' }],
      tools: {
        components: [{
          type: 'application',
          name: 'saferide-sbom',
          version: '1',
        }],
      },
      component: {
        type: 'application',
        'bom-ref': 'urn:saferide:source-tree',
        name: 'SafeRide source workspaces',
        version: readJson(rootDir, 'app.json').expo.version,
        components: workspaces.map(item => item.application),
      },
      properties: [
        { name: 'saferide:classification', value: 'public-safe-dependency-metadata' },
        { name: 'saferide:contains-user-data', value: 'false' },
        { name: 'saferide:contains-model-weights', value: 'false' },
      ],
    },
    components: workspaces.flatMap(item => item.components)
      .sort((left, right) => left['bom-ref'].localeCompare(right['bom-ref'])),
    dependencies: [
      {
        ref: 'urn:saferide:source-tree',
        dependsOn: workspaces.map(item => item.application['bom-ref']).sort(),
      },
      ...workspaces.flatMap(item => item.dependencies),
    ].sort((left, right) => left.ref.localeCompare(right.ref)),
  };
  const serialSeed = sha256Bytes(JSON.stringify(base));
  return {
    ...base,
    serialNumber: `urn:uuid:${uuidFromHex(serialSeed)}`,
  };
}

export function serializeSbom(sbom) {
  return `${JSON.stringify(sbom, null, 2)}\n`;
}

export function validateSourceSbom(sbom) {
  const errors = [];
  if (sbom.bomFormat !== 'CycloneDX') errors.push('SBOM bomFormat must be CycloneDX');
  if (sbom.specVersion !== '1.6') errors.push('SBOM specVersion must be 1.6');
  if (!/^urn:uuid:[0-9a-f-]{36}$/.test(sbom.serialNumber ?? '')) errors.push('SBOM serialNumber must be a deterministic UUID URN');
  const refs = new Set(['urn:saferide:source-tree']);
  for (const component of sbom.metadata?.component?.components ?? []) refs.add(component['bom-ref']);
  for (const component of sbom.components ?? []) {
    const ref = component['bom-ref'];
    if (!ref || refs.has(ref)) errors.push(`SBOM duplicate or missing bom-ref: ${ref ?? '<missing>'}`);
    refs.add(ref);
    for (const external of component.externalReferences ?? []) {
      try {
        const url = new URL(external.url);
        if (url.protocol !== 'https:' || url.username || url.password) {
          errors.push(`SBOM distribution URL is not credential-free HTTPS: ${component.name}`);
        }
      } catch {
        errors.push(`SBOM distribution URL is invalid: ${component.name}`);
      }
    }
  }
  for (const dependency of sbom.dependencies ?? []) {
    if (!refs.has(dependency.ref)) errors.push(`SBOM dependency source is unknown: ${dependency.ref}`);
    for (const target of dependency.dependsOn ?? []) {
      if (!refs.has(target)) errors.push(`SBOM dependency target is unknown: ${target}`);
    }
  }
  const serialized = JSON.stringify(sbom);
  if (/\/(?:home|Users)\//.test(serialized) || /(?:token|password|secret)=/i.test(serialized)) {
    errors.push('SBOM contains a local path or credential-like URL material');
  }
  return errors;
}
