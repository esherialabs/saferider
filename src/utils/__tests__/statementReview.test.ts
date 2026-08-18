import { describe, expect, it } from 'vitest';

import { DraftData } from '../draftStorage';
import {
  buildStatementReviewFromDraft,
  buildTranscriptSuggestions,
} from '../statementReview';

function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    id: 'draft-review-1',
    createdAt: new Date('2026-06-01T08:00:00.000Z'),
    updatedAt: new Date('2026-06-01T09:00:00.000Z'),
    status: 'draft',
    ...overrides,
  };
}

describe('statementReview', () => {
  it('gates a draft that only has shell metadata and no statement anchor', () => {
    const statement = buildStatementReviewFromDraft(buildDraft({
      selectedTags: ['harassment'],
      datetime: {
        date: '2026-06-01',
        time: '08:05',
        accuracy: 'approximate',
      },
      location: {
        description: 'Stage near market',
      },
    }));

    expect(statement).toBeNull();
  });

  it('builds a sparse review from saved incident details without adding sample content', () => {
    const statement = buildStatementReviewFromDraft(buildDraft({
      incidentDescription: 'The driver blocked the door when I asked to leave.',
      datetime: {
        date: '2026-06-01',
        time: '08:05',
        accuracy: 'approximate',
      },
      location: {
        address: 'River Road',
      },
    }));

    expect(statement?.content).toContain('Incident description: The driver blocked the door');
    expect(statement?.content).toContain('Date/time: 2026-06-01 08:05 (approximate)');
    expect(statement?.content).toContain('Location: River Road');
    expect(statement?.content).not.toContain('sample');
    expect(statement?.sources).toEqual(expect.arrayContaining([
      'Incident description',
      'Date, time, and location fields',
    ]));
  });

  it('includes complete draft context from evidence, tags, pathway, provider, escalation, and notes', () => {
    const statement = buildStatementReviewFromDraft(buildDraft({
      status: 'submitted',
      textEvidence: 'Saved statement text from the active draft.',
      incidentDescription: 'Driver blocked the door and made threats.',
      impactLevel: 'high',
      impactSummary: 'I felt unsafe leaving the vehicle.',
      witnesses: true,
      witnessDetails: 'A conductor saw the incident.',
      immediateHelp: false,
      patterns: ['blocking_path'],
      selectedTags: ['physical_threat'],
      acceptedSuggestions: ['intimidation'],
      customTags: ['route_change'],
      selectedPathway: 'referral',
      referralSelection: {
        providerId: 'provider-1',
        providerName: 'Usikimye Helpline',
        providerType: 'GBV center',
        selectedChannel: 'call',
        includeBrief: true,
        serviceScope: ['counselling', 'legal aid referral'],
        coverage: 'Nairobi',
        selectedAt: '2026-06-01T09:00:00.000Z',
      },
      escalationData: {
        redactionLevel: 'light',
        vehiclePlate: 'KDD 123A',
        saccoOperator: 'Route operator',
        contactPreference: 'alias',
        alias: 'Safe contact',
      },
      followUpAnswers: {
        safetyPlan: 'I can wait inside the shop nearby.',
      },
      mediaFiles: [
        {
          id: 'media-1',
          type: 'audio',
          uri: 'file:///private/audio.m4a',
          fileName: 'audio.m4a',
          size: 2048,
          timestamp: new Date('2026-06-01T08:06:00.000Z'),
          description: 'Audio note after the incident',
          checksum: 'ABC123',
          transcript: 'The driver refused to open the door.',
        },
      ],
    }));

    expect(statement?.content).toContain('Saved statement text from the active draft.');
    expect(statement?.content).toContain('Impact: I felt unsafe leaving the vehicle.');
    expect(statement?.content).toContain('Witness details: A conductor saw the incident.');
    expect(statement?.content).toContain('Tags: Physical Threat, Intimidation, Route Change');
    expect(statement?.content).toContain('Patterns: Blocking Path');
    expect(statement?.content).toContain('Audio evidence 1');
    expect(statement?.content).toContain('transcript saved');
    expect(statement?.content).toContain('Provider: Usikimye Helpline (GBV center)');
    expect(statement?.content).toContain('Vehicle plate: KDD 123A');
    expect(statement?.content).toContain('Safety Plan: I can wait inside the shop nearby.');
    expect(statement?.tags).toEqual([
      'physical_threat',
      'intimidation',
      'blocking_path',
      'route_change',
    ]);
    expect(statement?.sources).toEqual(expect.arrayContaining([
      'Evidence metadata',
      'Pathway and provider fields',
      'Escalation fields',
      'Follow-up answers',
    ]));
  });

  it('does not duplicate structured sections after a saved statement edit reloads', () => {
    const savedContent = [
      'Saved statement text from review.',
      'When and where: Date/time: 2026-06-01 08:05 (approximate)',
      'Evidence saved with this draft: Audio evidence 1, file "audio.m4a"',
    ].join('\n\n');

    const statement = buildStatementReviewFromDraft(buildDraft({
      textEvidence: savedContent,
      incidentDescription: 'Driver blocked the door and made threats.',
      datetime: {
        date: '2026-06-01',
        time: '08:05',
        accuracy: 'approximate',
      },
      mediaFiles: [
        {
          id: 'media-1',
          type: 'audio',
          uri: 'file:///private/audio.m4a',
          fileName: 'audio.m4a',
          size: 2048,
          timestamp: new Date('2026-06-01T08:06:00.000Z'),
        },
      ],
    }));

    expect(statement?.content).toBe(savedContent);
    expect(statement?.sources).toEqual(['Saved edited statement']);
  });

  it('uses only saved transcript text for transcript insertion suggestions', () => {
    const suggestions = buildTranscriptSuggestions(buildDraft({
      mediaFiles: [
        {
          id: 'media-1',
          type: 'audio',
          uri: 'file:///private/audio.m4a',
          fileName: 'audio.m4a',
          size: 2048,
          timestamp: new Date('2026-06-01T08:06:00.000Z'),
          transcript: 'First saved transcript sentence. Second saved transcript sentence is long enough.',
        },
      ],
    }));

    expect(suggestions).toEqual([
      'First saved transcript sentence.',
      'Second saved transcript sentence is long enough.',
    ]);
  });
});
