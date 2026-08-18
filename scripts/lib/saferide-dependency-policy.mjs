import fs from 'node:fs';
import path from 'node:path';

const POLICY_PATH = 'config/release/dependency-policy.v1.json';

function readJson(rootDir, relativePath) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, relativePath), 'utf8'));
}

function packageName(packagePath, entry) {
  if (entry.name) return entry.name;
  const tail = packagePath.slice(packagePath.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const parts = tail.split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

function inventoryKey(item) {
  return `${item.workspace}\0${item.packagePath}\0${item.name}\0${item.version}`;
}

export function validateDependencyPolicy({ rootDir, policy = readJson(rootDir, POLICY_PATH), lockOverrides = {} }) {
  const errors = [];
  const summary = [];
  const actualUnknownLicenses = [];
  const allowedOrigins = new Set(policy.allowedRegistryOrigins);

  if (policy.releaseAuditMaximum !== 'none') {
    errors.push('dependency policy: releaseAuditMaximum must remain none until a reviewed exception mechanism exists');
  }

  for (const definition of policy.lockfiles) {
    const lock = lockOverrides[definition.workspace] ?? readJson(rootDir, definition.path);
    const label = `${definition.workspace} dependency lock`;
    if (lock.lockfileVersion !== 3) errors.push(`${label}: lockfileVersion must be 3`);
    if (!lock.packages || typeof lock.packages !== 'object') {
      errors.push(`${label}: packages map is missing`);
      continue;
    }

    let count = 0;
    for (const [packagePath, entry] of Object.entries(lock.packages)) {
      if (!packagePath) continue;
      count += 1;
      const name = packageName(packagePath, entry);
      if (!entry.version) errors.push(`${label}: ${packagePath} has no version`);
      if (!entry.integrity) errors.push(`${label}: ${packagePath} has no integrity digest`);
      if (!entry.resolved) {
        errors.push(`${label}: ${packagePath} has no immutable resolved URL`);
      } else {
        const forbidden = policy.forbiddenDependencyProtocols.find(protocol => entry.resolved.startsWith(protocol));
        if (forbidden) errors.push(`${label}: ${packagePath} uses forbidden protocol ${forbidden}`);
        try {
          const resolved = new URL(entry.resolved);
          if (resolved.username || resolved.password) errors.push(`${label}: ${packagePath} resolved URL contains credentials`);
          if (!allowedOrigins.has(resolved.origin)) errors.push(`${label}: ${packagePath} resolved origin is not approved (${resolved.origin})`);
        } catch {
          errors.push(`${label}: ${packagePath} resolved URL is invalid`);
        }
      }
      if (!entry.license) {
        actualUnknownLicenses.push({
          workspace: definition.workspace,
          packagePath,
          name,
          version: entry.version,
        });
      }
    }
    summary.push({ workspace: definition.workspace, packages: count });
  }

  const expectedUnknown = new Set(policy.unknownLicenseInventory.map(inventoryKey));
  const actualUnknown = new Set(actualUnknownLicenses.map(inventoryKey));
  for (const key of actualUnknown) {
    if (!expectedUnknown.has(key)) errors.push(`dependency policy: unregistered unknown-license package ${key.replaceAll('\0', '/')}`);
  }
  for (const key of expectedUnknown) {
    if (!actualUnknown.has(key)) errors.push(`dependency policy: stale unknown-license inventory entry ${key.replaceAll('\0', '/')}`);
  }
  if (actualUnknown.size > 0 && !policy.unknownLicensesRequireLegalReview) {
    errors.push('dependency policy: unknown-license packages must require legal review');
  }

  return { ok: errors.length === 0, errors, summary, unknownLicenseCount: actualUnknown.size };
}
