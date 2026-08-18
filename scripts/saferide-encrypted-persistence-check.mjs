#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8');
}

const draftStorage = read('src/utils/draftStorage.ts');
const encryptedStorage = read('src/lib/encryptedAsyncStorage.ts');
const draftDatabase = read('src/utils/localDraftDatabase.ts');
const localBackup = read('src/utils/localEncryptedBackup.ts');
const privacyDataControls = read('src/utils/privacyDataControls.ts');
const draftTests = read('src/utils/__tests__/draftStorage.test.ts');
const storageNotes = read('docs/security/local-encrypted-storage-2026-06-06.md');

const checks = [];
function check(id, condition, failure) {
  checks.push({ id, condition: Boolean(condition), failure });
}

check(
  'device-bound-key-gate',
  encryptedStorage.includes('assertDeviceBoundLocalEncryptionAvailable') &&
    encryptedStorage.includes('AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY'),
  'Device-bound SecureStore gating is missing.',
);
check(
  'serialized-key-creation',
  encryptedStorage.includes('keyResolutionPromise') &&
    encryptedStorage.includes('resolveEncryptionKey'),
  'Concurrent first-use key creation is not serialized.',
);
check(
  'authenticated-row-encryption',
  draftStorage.includes('encryptLocalDataString') &&
    draftStorage.includes('draftRowEncryptionKey') &&
    draftStorage.includes('isEncryptedAsyncStorageEnvelope'),
  'Draft rows are not guarded by authenticated envelopes and per-row AAD.',
);
check(
  'atomic-versioned-migration',
  draftStorage.includes('DRAFT_STORAGE_V2_MIGRATION_STATE_KEY') &&
    draftStorage.includes('commitLegacyDraftMigration') &&
    draftDatabase.includes('withTransactionAsync'),
  'Versioned transactional draft migration is missing.',
);
check(
  'no-reverse-plaintext-migration',
  !draftStorage.includes('importSqliteDraftsToAsyncStorage') &&
    !draftStorage.includes('setLocalDraftItem'),
  'A reverse or plaintext draft migration helper is present.',
);
check(
  'verified-legacy-rewrite',
  encryptedStorage.includes('Encrypted storage migration could not be verified') &&
    !encryptedStorage.includes('legacy migration deferred'),
  'Sensitive legacy values can be returned without a verified encrypted rewrite.',
);
check(
  'raw-storage-tests',
  draftTests.includes("not.toContain(initial.incidentDescription)") &&
    draftTests.includes('preserves plaintext migration sources') &&
    draftTests.includes('blocks survivor draft persistence on web'),
  'Raw-storage, recovery, or fail-closed downgrade coverage is missing.',
);
check(
  'active-store-routing',
  [
    'src/utils/offlineSync.ts',
    'src/utils/workflowStateManager.ts',
    'src/utils/chatErrorHandling.ts',
    'src/utils/chatLocalSession.ts',
    'src/services/caseAdditionalInfoService.ts',
  ].every(path => read(path).includes('encryptedAsyncStorage')),
  'A sensitive active-store module is not routed through encrypted storage.',
);
check(
  'truthful-limitations',
  storageNotes.includes('SQLite index metadata is not encrypted') &&
    storageNotes.includes('Raw media file bytes are not encrypted by this layer') &&
    storageNotes.includes('forward-only'),
  'Storage limitations or forward-only rollback constraints are missing.',
);
check(
  'cryptographic-local-delete',
  encryptedStorage.includes('destroyDeviceBoundLocalEncryptionKey') &&
    privacyDataControls.includes('destroyDeviceBoundLocalEncryptionKey'),
  'Privacy deletion does not destroy cached and persisted device key material.',
);
check(
  'sqlite-remnant-purge',
  draftDatabase.includes('PRAGMA wal_checkpoint(TRUNCATE)') &&
    draftDatabase.includes('VACUUM') &&
    privacyDataControls.includes('purgeSqliteRemnants: true'),
  'Privacy deletion does not compact SQLite and truncate WAL remnants.',
);
check(
  'bounded-backup-kdf-input',
  localBackup.includes('MIN_KDF_ITERATIONS') &&
    localBackup.includes('MAX_KDF_ITERATIONS') &&
    localBackup.includes('MAX_PASSPHRASE_BYTES') &&
    localBackup.includes('decodeCanonicalBase64'),
  'Backup KDF, passphrase, or encoded input bounds are missing.',
);
check(
  'rollback-safe-restore',
  localBackup.includes('currentStores') &&
    localBackup.includes('The previous local SafeRide data was restored'),
  'Replace restore does not preserve and recover the previous local snapshot on failure.',
);

const failures = checks.filter(item => !item.condition);
if (failures.length > 0) {
  for (const failure of failures) {
    process.stderr.write(`[${failure.id}] ${failure.failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(`Encrypted persistence checks passed (${checks.length}/${checks.length}).\n`);
