import { encryptedAsyncStorage } from '../lib/encryptedAsyncStorage';
import { devPrivacyError, devPrivacyWarn, getPrivacySafeErrorReason } from '../utils/privacyLog';

export type CaseAdditionalInfoStatus = 'saved_local' | 'queued' | 'sent' | 'failed';
export type CaseAdditionalInfoRemoteState = 'unavailable' | 'not_attempted' | 'queued' | 'sent' | 'failed';
export type CaseAdditionalInfoNetworkState = 'online' | 'offline' | 'unknown';
export type CaseAdditionalInfoSource = 'case_detail' | 'case_tracker';

export type CaseAdditionalInfoEntry = {
  id: string;
  caseId: string;
  draftId: string | null;
  body: string;
  status: CaseAdditionalInfoStatus;
  source: CaseAdditionalInfoSource;
  createdAt: Date;
  updatedAt: Date;
  networkState: CaseAdditionalInfoNetworkState;
  remoteState: CaseAdditionalInfoRemoteState;
  remoteReason: string | null;
  syncQueueId: string | null;
  failureReason: string | null;
};

type SerializedCaseAdditionalInfoEntry = Omit<CaseAdditionalInfoEntry, 'createdAt' | 'updatedAt'> & {
  createdAt: string;
  updatedAt: string;
};

type OfflineStorageRecord = {
  id: string;
  data: SerializedCaseAdditionalInfoEntry[];
  lastModified: string;
  synced: boolean;
  pendingSync: boolean;
};

type AddCaseAdditionalInfoInput = {
  caseId: string;
  draftId?: string | null;
  body: string;
  source?: CaseAdditionalInfoSource;
  networkState?: CaseAdditionalInfoNetworkState;
  now?: Date;
};

export type AddCaseAdditionalInfoResult = {
  entry: CaseAdditionalInfoEntry;
  outcome: 'saved_local';
  remoteSendAvailable: false;
  userMessage: string;
};

export const CASE_ADDITIONAL_INFO_RECORD_PREFIX = 'case_additional_info_';
const STORAGE_KEY_PREFIX = `@offline_${CASE_ADDITIONAL_INFO_RECORD_PREFIX}`;

export const CASE_ADDITIONAL_INFO_REMOTE_UNAVAILABLE_REASON =
  'Case update sending is unavailable until SafeRide has a reviewed case update API.';

function buildRecordId(caseId: string): string {
  return `${CASE_ADDITIONAL_INFO_RECORD_PREFIX}${encodeURIComponent(caseId)}`;
}

function buildStorageKey(caseId: string): string {
  return `@offline_${buildRecordId(caseId)}`;
}

function buildEntryId(now: Date): string {
  return `case_info_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`;
}

function serializeEntry(entry: CaseAdditionalInfoEntry): SerializedCaseAdditionalInfoEntry {
  return {
    ...entry,
    createdAt: entry.createdAt.toISOString(),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

function hydrateEntry(entry: SerializedCaseAdditionalInfoEntry): CaseAdditionalInfoEntry {
  return {
    ...entry,
    createdAt: new Date(entry.createdAt),
    updatedAt: new Date(entry.updatedAt),
  };
}

function sortEntries(entries: CaseAdditionalInfoEntry[]): CaseAdditionalInfoEntry[] {
  return [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

function parseRecord(value: string | null): SerializedCaseAdditionalInfoEntry[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value) as Partial<OfflineStorageRecord>;
    return Array.isArray(parsed.data) ? parsed.data : [];
  } catch (error) {
    devPrivacyWarn('case additional info store parse failed', {
      reason: getPrivacySafeErrorReason(error),
    });
    return [];
  }
}

async function readEntriesForCase(caseId: string): Promise<CaseAdditionalInfoEntry[]> {
  const raw = await encryptedAsyncStorage.getItem(buildStorageKey(caseId));
  return sortEntries(parseRecord(raw).map(hydrateEntry));
}

async function writeEntriesForCase(caseId: string, entries: CaseAdditionalInfoEntry[], now: Date): Promise<void> {
  const record: OfflineStorageRecord = {
    id: buildRecordId(caseId),
    data: sortEntries(entries).map(serializeEntry),
    lastModified: now.toISOString(),
    synced: true,
    pendingSync: false,
  };

  await encryptedAsyncStorage.setItem(buildStorageKey(caseId), JSON.stringify(record));
}

export async function getCaseAdditionalInfo(caseId: string): Promise<CaseAdditionalInfoEntry[]> {
  if (!caseId.trim()) return [];

  try {
    return readEntriesForCase(caseId);
  } catch (error) {
    devPrivacyWarn('case additional info load failed', {
      reason: getPrivacySafeErrorReason(error),
    });
    return [];
  }
}

export async function getAllCaseAdditionalInfo(): Promise<CaseAdditionalInfoEntry[]> {
  try {
    const keys = (await encryptedAsyncStorage.getAllKeys()).filter(key => key.startsWith(STORAGE_KEY_PREFIX));
    const records = await encryptedAsyncStorage.multiGet(keys);
    const entries = records.flatMap(([, value]) => parseRecord(value).map(hydrateEntry));
    return sortEntries(entries);
  } catch (error) {
    devPrivacyWarn('case additional info list failed', {
      reason: getPrivacySafeErrorReason(error),
    });
    return [];
  }
}

export async function addCaseAdditionalInfo(
  input: AddCaseAdditionalInfoInput,
): Promise<AddCaseAdditionalInfoResult> {
  const caseId = input.caseId.trim();
  const body = input.body.trim();
  const now = input.now ?? new Date();

  if (!caseId) {
    throw new Error('A case identifier is required before adding information.');
  }

  if (!body) {
    throw new Error('Enter the information you want to save.');
  }

  const entry: CaseAdditionalInfoEntry = {
    id: buildEntryId(now),
    caseId,
    draftId: input.draftId ?? null,
    body,
    status: 'saved_local',
    source: input.source ?? 'case_detail',
    createdAt: now,
    updatedAt: now,
    networkState: input.networkState ?? 'unknown',
    remoteState: 'unavailable',
    remoteReason: CASE_ADDITIONAL_INFO_REMOTE_UNAVAILABLE_REASON,
    syncQueueId: null,
    failureReason: null,
  };

  try {
    const existingEntries = await readEntriesForCase(caseId);
    await writeEntriesForCase(caseId, [entry, ...existingEntries], now);
  } catch (error) {
    devPrivacyError('case additional info save failed', {
      reason: getPrivacySafeErrorReason(error),
    });
    throw new Error('Additional information could not be saved on this device.');
  }

  return {
    entry,
    outcome: 'saved_local',
    remoteSendAvailable: false,
    userMessage:
      'Saved on this device. Sending the update to a provider is unavailable in this release.',
  };
}
