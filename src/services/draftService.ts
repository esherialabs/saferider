import { draftStorage, DraftData } from '../utils/draftStorage';

export async function fetchDrafts(_options: { forceRemote?: boolean } = {}): Promise<DraftData[]> {
  return draftStorage.getAllDrafts();
}

export async function getDraftById(
  draftId: string,
  _options: { forceRemote?: boolean } = {},
): Promise<DraftData | null> {
  return draftStorage.getDraft(draftId);
}

export async function saveDraft(
  draft: DraftData,
  _options: { enqueueSync?: boolean; syncRemote?: boolean } = {},
): Promise<DraftData> {
  return draftStorage.saveDraft({
    ...draft,
    updatedAt: new Date(),
  });
}

export async function deleteDraft(
  draftId: string,
  _options: { enqueueSync?: boolean; syncRemote?: boolean } = {},
): Promise<void> {
  await draftStorage.deleteDraft(draftId);
}
