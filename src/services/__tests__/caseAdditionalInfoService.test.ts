import AsyncStorage from '@react-native-async-storage/async-storage';
import { describe, expect, it, vi } from 'vitest';

import { encryptedAsyncStorage, isEncryptedAsyncStorageEnvelope } from '../../lib/encryptedAsyncStorage';
import {
  CASE_ADDITIONAL_INFO_REMOTE_UNAVAILABLE_REASON,
  addCaseAdditionalInfo,
  getAllCaseAdditionalInfo,
  getCaseAdditionalInfo,
} from '../caseAdditionalInfoService';

describe('caseAdditionalInfoService', () => {
  it('saves additional information locally before reporting success', async () => {
    const result = await addCaseAdditionalInfo({
      caseId: 'case-123',
      draftId: 'draft-123',
      body: '  The provider asked me to add the bus plate number.  ',
      source: 'case_detail',
      networkState: 'online',
      now: new Date('2026-06-05T10:00:00.000Z'),
    });

    expect(result).toMatchObject({
      outcome: 'saved_local',
      remoteSendAvailable: false,
      userMessage: expect.stringContaining('Saved on this device'),
    });
    expect(result.entry).toMatchObject({
      caseId: 'case-123',
      draftId: 'draft-123',
      body: 'The provider asked me to add the bus plate number.',
      status: 'saved_local',
      networkState: 'online',
      remoteState: 'unavailable',
      remoteReason: CASE_ADDITIONAL_INFO_REMOTE_UNAVAILABLE_REASON,
      syncQueueId: null,
    });

    const saved = await getCaseAdditionalInfo('case-123');
    expect(saved).toHaveLength(1);
    expect(saved[0].body).toBe('The provider asked me to add the bus plate number.');
    expect(saved[0].createdAt).toEqual(new Date('2026-06-05T10:00:00.000Z'));
  });

  it('preserves prior entries and keeps case histories separate', async () => {
    await addCaseAdditionalInfo({
      caseId: 'case-123',
      body: 'First update.',
      now: new Date('2026-06-05T10:00:00.000Z'),
    });
    await addCaseAdditionalInfo({
      caseId: 'case-456',
      body: 'Different case update.',
      now: new Date('2026-06-05T10:01:00.000Z'),
    });
    await addCaseAdditionalInfo({
      caseId: 'case-123',
      body: 'Second update.',
      now: new Date('2026-06-05T10:02:00.000Z'),
    });

    const caseEntries = await getCaseAdditionalInfo('case-123');
    expect(caseEntries.map(entry => entry.body)).toEqual(['Second update.', 'First update.']);

    const allEntries = await getAllCaseAdditionalInfo();
    expect(allEntries.map(entry => entry.caseId)).toEqual(['case-123', 'case-456', 'case-123']);
  });

  it('records offline saves without pretending a provider send was queued', async () => {
    const result = await addCaseAdditionalInfo({
      caseId: 'case-offline',
      body: 'I am adding this while offline.',
      networkState: 'offline',
      now: new Date('2026-06-05T10:03:00.000Z'),
    });

    expect(result.entry).toMatchObject({
      status: 'saved_local',
      networkState: 'offline',
      remoteState: 'unavailable',
      syncQueueId: null,
    });

    const storedPayload = vi.mocked(AsyncStorage.setItem).mock.calls[0][1];
    expect(isEncryptedAsyncStorageEnvelope(storedPayload)).toBe(true);
    expect(storedPayload).not.toContain('I am adding this while offline.');
    const decryptedPayload = await encryptedAsyncStorage.getItem('@offline_case_additional_info_case-offline');
    expect(JSON.parse(decryptedPayload ?? '{}')).toMatchObject({
      synced: true,
      pendingSync: false,
    });
  });

  it('rejects blank updates', async () => {
    await expect(addCaseAdditionalInfo({
      caseId: 'case-123',
      body: '   ',
    })).rejects.toThrow('Enter the information you want to save.');

    expect(await getCaseAdditionalInfo('case-123')).toEqual([]);
  });

  it('does not claim success when local persistence fails', async () => {
    vi.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('storage unavailable'));

    await expect(addCaseAdditionalInfo({
      caseId: 'case-123',
      body: 'This should not be acknowledged.',
      now: new Date('2026-06-05T10:04:00.000Z'),
    })).rejects.toThrow('Additional information could not be saved on this device.');

    expect(await getCaseAdditionalInfo('case-123')).toEqual([]);
  });
});
