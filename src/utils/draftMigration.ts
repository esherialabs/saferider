import AsyncStorage from '@react-native-async-storage/async-storage';
import { Storage, IncidentDraft } from '../lib/storage';
import { draftStorage, DraftData } from './draftStorage';
import { DRAFT_MIGRATION_V1_FLAG_KEY as MIGRATION_FLAG_KEY } from './storageKeys';
import { devPrivacyInfo, getPrivacySafeErrorReason } from './privacyLog';

function getFileNameFromUri(uri: string): string {
  try {
    const parts = uri.split('/');
    return parts[parts.length - 1] || 'file';
  } catch {
    return 'file';
  }
}

function mapIncidentDraftToDraftData(d: IncidentDraft): DraftData {
  const createdAt = new Date(d.timestamp);
  const updatedAt = new Date(d.timestamp);

  // Map evidence: audio + photos
  const mediaFiles: DraftData['mediaFiles'] = [];
  if (Array.isArray(d.evidence?.audioRecordings)) {
    for (const uri of d.evidence.audioRecordings) {
      mediaFiles.push({
        id: `audio_${Math.random().toString(36).slice(2)}`,
        type: 'audio',
        uri,
        fileName: getFileNameFromUri(uri),
        size: 0,
        timestamp: createdAt,
        description: 'Imported from SecureStore',
      });
    }
  }
  if (Array.isArray(d.evidence?.photos)) {
    for (const uri of d.evidence.photos) {
      mediaFiles.push({
        id: `photo_${Math.random().toString(36).slice(2)}`,
        type: 'photo',
        uri,
        fileName: getFileNameFromUri(uri),
        size: 0,
        timestamp: createdAt,
        description: 'Imported from SecureStore',
      });
    }
  }

  const dateObj = new Date(d.details?.datetime || d.timestamp);
  const iso = dateObj.toISOString();

  const draft: DraftData = {
    id: d.id,
    createdAt,
    updatedAt,
    currentStep: 'EvidenceDetail',
    completedSteps: [],
    autoSaveEnabled: true,
    incidentDescription: d.details?.whatHappened || '',
    textEvidence: d.evidence?.notes || '',
    location: {
      address: d.details?.location?.address,
      coordinates: d.details?.location?.coordinates,
    },
    datetime: {
      date: iso.slice(0, 10),
      time: iso.slice(11, 16),
      accuracy: 'estimated',
    },
    mediaFiles,
    // Optional tagging/selection fields left empty for now
  };

  return draft;
}

export async function migrateSecureStoreDraftsIfNeeded(): Promise<boolean> {
  try {
    const flag = await AsyncStorage.getItem(MIGRATION_FLAG_KEY);
    if (flag === 'true') return false;

    const legacyDrafts = await Storage.getDrafts();
    if (!legacyDrafts || legacyDrafts.length === 0) {
      await AsyncStorage.setItem(MIGRATION_FLAG_KEY, 'true');
      return false;
    }

    for (const legacy of legacyDrafts) {
      const mapped = mapIncidentDraftToDraftData(legacy);
      await draftStorage.saveDraft(mapped);
    }

    await AsyncStorage.setItem(MIGRATION_FLAG_KEY, 'true');
    return true;
  } catch (err) {
    devPrivacyInfo('legacy draft migration skipped', {
      reason: getPrivacySafeErrorReason(err),
    });
    return false;
  }
}

