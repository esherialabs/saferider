import { describe, expect, it } from 'vitest';

import { draftStorage, type DraftData } from '../draftStorage';

describe('evidence vault draft persistence', () => {
  it('persists evidence capture source, notes, upload status, and transcript fields', async () => {
    const draft: DraftData = {
      id: 'vault-draft-1',
      createdAt: new Date('2026-06-06T06:00:00.000Z'),
      updatedAt: new Date('2026-06-06T06:00:00.000Z'),
      currentStep: 'EvidenceDetail',
      completedSteps: ['WhatHappened', 'WhereWhen'],
      mediaFiles: [
        {
          id: 'audio-1',
          type: 'audio',
          uri: 'file:///drafts/audio-1.m4a',
          fileName: 'audio-1.m4a',
          size: 4096,
          timestamp: new Date('2026-06-06T06:01:00.000Z'),
          captureSource: 'microphone',
          description: 'Recorded after exiting the vehicle.',
          transcript: 'Driver shouted after I asked to exit.',
          checksum: 'abc123',
          uploadStatus: 'failed',
          uploadError: 'network_error',
        },
      ],
    };

    await draftStorage.saveDraft(draft);

    const saved = await draftStorage.getDraft(draft.id);

    expect(saved?.mediaFiles?.[0]).toMatchObject({
      id: 'audio-1',
      captureSource: 'microphone',
      description: 'Recorded after exiting the vehicle.',
      transcript: 'Driver shouted after I asked to exit.',
      checksum: 'abc123',
      uploadStatus: 'failed',
      uploadError: 'network_error',
    });
    expect(saved?.mediaFiles?.[0].timestamp).toEqual(new Date('2026-06-06T06:01:00.000Z'));
  });
});
