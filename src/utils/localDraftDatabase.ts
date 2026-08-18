import * as SQLite from 'expo-sqlite';

import { devPrivacyError, getPrivacySafeErrorReason } from './privacyLog';

const DATABASE_NAME = 'saferide-local-drafts.db';

type SQLiteDatabase = SQLite.SQLiteDatabase;

export interface LocalDraftRow {
  id: string;
  created_at: string;
  updated_at: string;
  status: string | null;
  current_step: string | null;
  encrypted_payload: string;
}

export interface LocalDraftRowInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  status?: string | null;
  currentStep?: string | null;
  encryptedPayload: string;
}

export interface LocalDraftMigrationCommit {
  rows: LocalDraftRowInput[];
  activeDraftEncryptedValue: string | null;
  migrationStateKey: string;
  migrationStateValue: string;
}

class LocalDraftDatabase {
  private databasePromise: Promise<SQLiteDatabase | null> | null = null;

  private isWebRuntime(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined';
  }

  private async open(): Promise<SQLiteDatabase | null> {
    if (this.isWebRuntime()) {
      return null;
    }

    try {
      const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS incident_draft_records (
          id TEXT PRIMARY KEY NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          status TEXT,
          current_step TEXT,
          encrypted_payload TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_incident_draft_records_updated_at
          ON incident_draft_records(updated_at DESC);
        CREATE TABLE IF NOT EXISTS local_kv (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        PRAGMA user_version = 1;
      `);
      return db;
    } catch (error) {
      devPrivacyError('local draft database open failed', {
        reason: getPrivacySafeErrorReason(error),
      });
      throw error;
    }
  }

  async getDatabase(): Promise<SQLiteDatabase | null> {
    if (!this.databasePromise) {
      this.databasePromise = this.open();
    }

    return this.databasePromise;
  }

  async isAvailable(): Promise<boolean> {
    return (await this.getDatabase()) !== null;
  }

  async getDraftCount(): Promise<number> {
    const db = await this.getDatabase();
    if (!db) return 0;

    const row = await db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) as count FROM incident_draft_records',
    );
    return row?.count ?? 0;
  }

  async getAllDraftRows(): Promise<LocalDraftRow[]> {
    const db = await this.getDatabase();
    if (!db) return [];

    return db.getAllAsync<LocalDraftRow>(
      'SELECT id, created_at, updated_at, status, current_step, encrypted_payload FROM incident_draft_records ORDER BY updated_at DESC',
    );
  }

  async getDraftRow(id: string): Promise<LocalDraftRow | null> {
    const db = await this.getDatabase();
    if (!db) return null;

    return db.getFirstAsync<LocalDraftRow>(
      'SELECT id, created_at, updated_at, status, current_step, encrypted_payload FROM incident_draft_records WHERE id = ? LIMIT 1',
      id,
    );
  }

  async upsertDraftRow(row: LocalDraftRowInput): Promise<void> {
    const db = await this.getDatabase();
    if (!db) return;

    await db.runAsync(
      `INSERT INTO incident_draft_records (
        id,
        created_at,
        updated_at,
        status,
        current_step,
        encrypted_payload
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        status = excluded.status,
        current_step = excluded.current_step,
        encrypted_payload = excluded.encrypted_payload`,
      row.id,
      row.createdAt,
      row.updatedAt,
      row.status ?? null,
      row.currentStep ?? null,
      row.encryptedPayload,
    );
  }

  async replaceDraftRows(rows: LocalDraftRowInput[]): Promise<void> {
    const db = await this.getDatabase();
    if (!db) return;

    // Atomic: a crash mid-replace must never leave the table half-written.
    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM incident_draft_records');
      for (const row of rows) {
        await db.runAsync(
          `INSERT INTO incident_draft_records (
            id,
            created_at,
            updated_at,
            status,
            current_step,
            encrypted_payload
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            status = excluded.status,
            current_step = excluded.current_step,
            encrypted_payload = excluded.encrypted_payload`,
          row.id,
          row.createdAt,
          row.updatedAt,
          row.status ?? null,
          row.currentStep ?? null,
          row.encryptedPayload,
        );
      }
    });
  }

  /**
   * Atomically promotes legacy draft state into the encrypted SQLite store.
   * Encryption happens before entering the transaction, so a failed commit
   * leaves both the old rows and the legacy source available for retry.
   */
  async commitLegacyDraftMigration(commit: LocalDraftMigrationCommit): Promise<void> {
    const db = await this.getDatabase();
    if (!db) {
      throw new Error('The native draft database is unavailable.');
    }

    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM incident_draft_records');
      for (const row of commit.rows) {
        await db.runAsync(
          `INSERT INTO incident_draft_records (
            id,
            created_at,
            updated_at,
            status,
            current_step,
            encrypted_payload
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            status = excluded.status,
            current_step = excluded.current_step,
            encrypted_payload = excluded.encrypted_payload`,
          row.id,
          row.createdAt,
          row.updatedAt,
          row.status ?? null,
          row.currentStep ?? null,
          row.encryptedPayload,
        );
      }

      if (commit.activeDraftEncryptedValue === null) {
        await db.runAsync('DELETE FROM local_kv WHERE key = ?', 'incident_active_draft_id');
      } else {
        await db.runAsync(
          `INSERT INTO local_kv (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at`,
          'incident_active_draft_id',
          commit.activeDraftEncryptedValue,
          new Date().toISOString(),
        );
      }

      await db.runAsync(
        `INSERT INTO local_kv (key, value, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at`,
        commit.migrationStateKey,
        commit.migrationStateValue,
        new Date().toISOString(),
      );
    });
  }

  async deleteDraftRow(id: string): Promise<void> {
    const db = await this.getDatabase();
    if (!db) return;

    await db.runAsync('DELETE FROM incident_draft_records WHERE id = ?', id);
  }

  async clearDraftRows(): Promise<void> {
    const db = await this.getDatabase();
    if (!db) return;

    await db.runAsync('DELETE FROM incident_draft_records');
  }

  async getKeyValue(key: string): Promise<string | null> {
    const db = await this.getDatabase();
    if (!db) return null;

    const row = await db.getFirstAsync<{ value: string }>(
      'SELECT value FROM local_kv WHERE key = ? LIMIT 1',
      key,
    );
    return row?.value ?? null;
  }

  async setKeyValue(key: string, value: string): Promise<void> {
    const db = await this.getDatabase();
    if (!db) return;

    await db.runAsync(
      `INSERT INTO local_kv (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = excluded.updated_at`,
      key,
      value,
      new Date().toISOString(),
    );
  }

  async removeKeyValue(key: string): Promise<void> {
    const db = await this.getDatabase();
    if (!db) return;

    await db.runAsync('DELETE FROM local_kv WHERE key = ?', key);
  }

  async clearKeyValues(): Promise<void> {
    const db = await this.getDatabase();
    if (!db) return;

    await db.runAsync('DELETE FROM local_kv');
  }

  async clearAllDraftData(): Promise<void> {
    const db = await this.getDatabase();
    if (!db) return;

    await db.withTransactionAsync(async () => {
      await db.runAsync('DELETE FROM incident_draft_records');
      await db.runAsync('DELETE FROM local_kv');
    });
  }

  async purgeAllDraftData(): Promise<void> {
    const db = await this.getDatabase();
    if (!db) return;

    await this.clearAllDraftData();
    await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
    await db.execAsync('VACUUM;');
    await db.execAsync('PRAGMA wal_checkpoint(TRUNCATE);');
  }
}

export const localDraftDatabase = new LocalDraftDatabase();
