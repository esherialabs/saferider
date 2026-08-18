import * as SQLite from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { localDraftDatabase } from '../localDraftDatabase';

describe('localDraftDatabase migration transaction', () => {
  it('truncates WAL remnants and vacuums after privacy purge', async () => {
    await localDraftDatabase.upsertDraftRow({
      id: 'purge-row',
      createdAt: '2026-06-01T08:00:00.000Z',
      updatedAt: '2026-06-01T08:00:00.000Z',
      encryptedPayload: 'encrypted-purge-payload',
    });
    const db = await SQLite.openDatabaseAsync('saferide-local-drafts.db');
    vi.mocked(db.execAsync).mockClear();

    await localDraftDatabase.purgeAllDraftData();

    await expect(localDraftDatabase.getDraftCount()).resolves.toBe(0);
    expect(db.execAsync).toHaveBeenNthCalledWith(1, 'PRAGMA wal_checkpoint(TRUNCATE);');
    expect(db.execAsync).toHaveBeenNthCalledWith(2, 'VACUUM;');
    expect(db.execAsync).toHaveBeenNthCalledWith(3, 'PRAGMA wal_checkpoint(TRUNCATE);');
  });

  it('rolls back replaced rows and key values when the migration marker cannot commit', async () => {
    await localDraftDatabase.upsertDraftRow({
      id: 'recoverable-old-row',
      createdAt: '2026-06-01T08:00:00.000Z',
      updatedAt: '2026-06-01T08:00:00.000Z',
      encryptedPayload: 'recoverable-old-payload',
    });
    await localDraftDatabase.setKeyValue('incident_active_draft_id', 'recoverable-old-pointer');

    const db = await SQLite.openDatabaseAsync('saferide-local-drafts.db');
    const runAsyncMock = db.runAsync as any;
    const originalRunAsync = runAsyncMock.getMockImplementation();
    runAsyncMock.mockImplementation(async (sql: string, ...params: unknown[]) => {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.startsWith('insert into local_kv') && params[0] === 'migration-state') {
        throw new Error('synthetic marker failure');
      }
      return originalRunAsync(sql, ...params);
    });

    try {
      await expect(localDraftDatabase.commitLegacyDraftMigration({
        rows: [{
          id: 'replacement-row',
          createdAt: '2026-06-01T09:00:00.000Z',
          updatedAt: '2026-06-01T09:00:00.000Z',
          encryptedPayload: 'replacement-payload',
        }],
        activeDraftEncryptedValue: 'replacement-pointer',
        migrationStateKey: 'migration-state',
        migrationStateValue: 'committed',
      })).rejects.toThrow('synthetic marker failure');
    } finally {
      runAsyncMock.mockImplementation(originalRunAsync);
    }

    await expect(localDraftDatabase.getDraftRow('recoverable-old-row')).resolves.not.toBeNull();
    await expect(localDraftDatabase.getDraftRow('replacement-row')).resolves.toBeNull();
    await expect(localDraftDatabase.getKeyValue('incident_active_draft_id'))
      .resolves.toBe('recoverable-old-pointer');
    await expect(localDraftDatabase.getKeyValue('migration-state')).resolves.toBeNull();
    expect(db.withTransactionAsync).toHaveBeenCalledOnce();
  });
});
