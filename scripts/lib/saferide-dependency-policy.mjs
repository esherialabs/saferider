import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

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

function sha256File(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
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
  const reviewedLicenses = new Map((policy.reviewedLicenseInventory ?? []).map(item => [inventoryKey(item), item]));
  const actualUnknown = new Set(actualUnknownLicenses.map(inventoryKey));
  for (const key of actualUnknown) {
    if (!expectedUnknown.has(key) && !reviewedLicenses.has(key)) {
      errors.push(`dependency policy: unregistered unknown-license package ${key.replaceAll('\0', '/')}`);
    }
  }
  for (const key of expectedUnknown) {
    if (!actualUnknown.has(key)) errors.push(`dependency policy: stale unknown-license inventory entry ${key.replaceAll('\0', '/')}`);
  }
  for (const [key, review] of reviewedLicenses) {
    if (!actualUnknown.has(key)) {
      errors.push(`dependency policy: stale reviewed-license inventory entry ${key.replaceAll('\0', '/')}`);
      continue;
    }
    const evidencePath = path.resolve(rootDir, review.evidencePath);
    if (!evidencePath.startsWith(`${path.resolve(rootDir)}${path.sep}`) || !fs.existsSync(evidencePath)) {
      errors.push(`dependency policy: reviewed-license evidence is unavailable (${review.evidencePath})`);
    } else if (sha256File(evidencePath) !== review.evidenceSha256) {
      errors.push(`dependency policy: reviewed-license evidence hash mismatch (${review.evidencePath})`);
    }
  }
  const unresolvedUnknownCount = [...actualUnknown].filter(key => !reviewedLicenses.has(key)).length;
  if (unresolvedUnknownCount > 0 && !policy.unknownLicensesRequireLegalReview) {
    errors.push('dependency policy: unknown-license packages must require legal review');
  }

  return {
    ok: errors.length === 0,
    errors,
    summary,
    unknownLicenseCount: unresolvedUnknownCount,
    reviewedLicenseCount: reviewedLicenses.size,
  };
}
