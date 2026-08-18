import type { DraftData } from './draftStorage';

/**
 * Pure merge rules for persisting report drafts.
 *
 * Multiple screens hold their own snapshot of a draft while the user moves
 * through the report wizard. A snapshot can be stale by the time it is saved
 * (another screen wrote newer data in between). These rules protect persisted
 * report data from being wiped by a stale snapshot:
 *
 * - `completedSteps` are unioned so progress is never lost.
 * - `followUpAnswers` are merged key-by-key.
 * - Core evidence fields (patterns, location, datetime, mediaFiles,
 *   textEvidence) only accept an "empty" incoming value when the caller
 *   explicitly listed that field in `explicitKeys` (i.e. the user really
 *   cleared it), otherwise the persisted value wins.
 */

function hasItems<T>(value?: T[] | null): boolean {
  return Array.isArray(value) && value.length > 0;
}

function mergeUniqueStrings(...values: Array<string[] | undefined>): string[] | undefined {
  const merged = values.flatMap(value => value ?? []);
  return merged.length > 0 ? Array.from(new Set(merged)) : undefined;
}

function hasLocationData(draft?: DraftData | null): boolean {
  return Boolean(
    draft?.location?.address ||
    draft?.location?.description ||
    draft?.location?.type ||
    draft?.location?.coordinates,
  );
}

function hasEvidenceData(draft?: DraftData | null): boolean {
  return Boolean(
    hasItems(draft?.mediaFiles) ||
    (typeof draft?.textEvidence === 'string' && draft.textEvidence.trim().length > 0),
  );
}

function hasTextEvidence(draft?: DraftData | null): boolean {
  return typeof draft?.textEvidence === 'string' && draft.textEvidence.trim().length > 0;
}

function hasKey(keys: Set<keyof DraftData> | undefined, key: keyof DraftData): boolean {
  return Boolean(keys?.has(key));
}

export function getDraftUpdateKeys(updates: Partial<DraftData>): Set<keyof DraftData> {
  return new Set(Object.keys(updates) as Array<keyof DraftData>);
}

export function mergeDraftForLocalPersistence(
  persisted: DraftData | null | undefined,
  incoming: DraftData,
  explicitKeys?: Set<keyof DraftData>,
): DraftData {
  if (!persisted || persisted.id !== incoming.id) {
    return incoming;
  }

  const completedSteps = mergeUniqueStrings(persisted.completedSteps, incoming.completedSteps);
  const merged: DraftData = {
    ...persisted,
    ...incoming,
    id: incoming.id,
    createdAt: persisted.createdAt ?? incoming.createdAt,
    updatedAt: incoming.updatedAt,
    completedSteps,
    followUpAnswers: {
      ...(persisted.followUpAnswers ?? {}),
      ...(incoming.followUpAnswers ?? {}),
    },
  };

  if (!hasKey(explicitKeys, 'patterns') && hasItems(persisted.patterns) && !hasItems(incoming.patterns)) {
    merged.patterns = persisted.patterns;
  }

  if (!hasKey(explicitKeys, 'location') && hasLocationData(persisted) && !hasLocationData(incoming)) {
    merged.location = persisted.location;
  }

  if (!hasKey(explicitKeys, 'datetime') && persisted.datetime && !incoming.datetime) {
    merged.datetime = persisted.datetime;
  }

  if (!hasKey(explicitKeys, 'mediaFiles') && hasItems(persisted.mediaFiles) && !hasItems(incoming.mediaFiles)) {
    merged.mediaFiles = persisted.mediaFiles;
  }

  if (!hasKey(explicitKeys, 'textEvidence') && hasTextEvidence(persisted) && !hasTextEvidence(incoming)) {
    merged.textEvidence = persisted.textEvidence;
  }

  return merged;
}
