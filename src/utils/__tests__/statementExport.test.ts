import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  copyAsync: vi.fn(),
  getContentUriAsync: vi.fn(),
  getInfoAsync: vi.fn(),
  printToFileAsync: vi.fn(),
  share: vi.fn(),
  writeAsStringAsync: vi.fn(),
}));

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///docs/',
  copyAsync: mocks.copyAsync,
  getContentUriAsync: mocks.getContentUriAsync,
  getInfoAsync: mocks.getInfoAsync,
  writeAsStringAsync: mocks.writeAsStringAsync,
}));

vi.mock('expo-print', () => ({
  printToFileAsync: mocks.printToFileAsync,
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
  Share: {
    dismissedAction: 'dismissedAction',
    sharedAction: 'sharedAction',
    share: mocks.share,
  },
}));

import { DraftData } from '../draftStorage';
import {
  StatementExportError,
  buildStatementExportPayload,
  createStatementPdfExport,
  createStatementStructuredExport,
  getStatementExportShareNotice,
  shareStatementExportFile,
} from '../statementExport';

function buildDraft(overrides: Partial<DraftData> = {}): DraftData {
  return {
    id: 'draft-statement-1',
    createdAt: new Date('2026-06-01T08:00:00.000Z'),
    updatedAt: new Date('2026-06-02T09:30:00.000Z'),
    status: 'draft',
    currentStep: 'StatementReview',
    incidentDescription: 'Driver blocked the door and made threats.',
    impactLevel: 'high',
    impactSummary: 'I felt unsafe leaving the vehicle.',
    witnesses: true,
    witnessDetails: 'A conductor saw the incident.',
    textEvidence: 'Saved statement text from the active draft.',
    selectedTags: ['physical_threat', 'blocking_path'],
    acceptedSuggestions: ['intimidation'],
    location: {
      description: 'Stage near the market',
      address: 'River Road',
      coordinates: {
        latitude: -1.283,
        longitude: 36.817,
      },
    },
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
        description: 'Audio note',
        mimeType: 'audio/mp4',
        checksum: 'ABC123',
        transcript: 'Transcript text from a saved evidence item.',
      },
    ],
    privacySettings: {
      blurFaces: true,
      removeMetadata: true,
      encryptFiles: true,
    },
    ...overrides,
  };
}

describe('statementExport', () => {
  beforeEach(() => {
    mocks.copyAsync.mockResolvedValue(undefined);
    mocks.getContentUriAsync.mockResolvedValue('content://statement.pdf');
    mocks.getInfoAsync.mockResolvedValue({ exists: true, isDirectory: false, size: 512 });
    mocks.printToFileAsync.mockResolvedValue({ uri: 'file:///cache/printed.pdf' });
    mocks.share.mockResolvedValue({ action: 'sharedAction' });
    mocks.writeAsStringAsync.mockResolvedValue(undefined);
  });

  it('builds statement export content from the active saved draft and evidence metadata', () => {
    const payload = buildStatementExportPayload(buildDraft(), {
      generatedAt: '2026-06-06T00:00:00.000Z',
    });

    expect(payload.statement.text).toContain('Saved statement text from the active draft.');
    expect(payload.statement.text).toContain('Impact: I felt unsafe leaving the vehicle.');
    expect(payload.statement.text).toContain('Witness details: A conductor saw the incident.');
    expect(payload.statement.tags).toEqual(['physical_threat', 'blocking_path', 'intimidation']);
    expect(payload.evidenceManifest).toEqual([
      expect.objectContaining({
        id: 'media-1',
        type: 'audio',
        fileName: 'audio.m4a',
        checksum: 'ABC123',
        hasTranscript: true,
        transcriptWordCount: 7,
      }),
    ]);
    expect(JSON.stringify(payload.evidenceManifest)).not.toContain('file:///private/audio.m4a');
  });

  it('fails clearly when saved draft statement data is missing', () => {
    const draft = buildDraft({
      incidentDescription: undefined,
      impactSummary: undefined,
      mediaFiles: [],
      textEvidence: undefined,
      witnesses: false,
      witnessDetails: undefined,
    });

    expect(() => buildStatementExportPayload(draft)).toThrow(StatementExportError);

    try {
      buildStatementExportPayload(draft);
    } catch (error) {
      expect(error).toBeInstanceOf(StatementExportError);
      expect((error as StatementExportError).code).toBe('missing_draft_data');
    }
  });

  it('writes parseable structured JSON export files', async () => {
    const result = await createStatementStructuredExport(buildDraft(), {
      generatedAt: '2026-06-06T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
    expect(result.filePath).toMatch(/SafeRide_Statement_draft-statement-1_2026-06-06T00-00-00-000Z\.json$/);
    expect(mocks.writeAsStringAsync).toHaveBeenCalledTimes(1);
    const writtenJson = mocks.writeAsStringAsync.mock.calls[0][1] as string;
    const parsed = JSON.parse(writtenJson);
    expect(parsed.exportMetadata.schema).toBe('com.saferide.statement-export');
    expect(parsed.statement.text).toContain('Saved statement text from the active draft.');
    expect(parsed.evidenceManifest[0].fileName).toBe('audio.m4a');
  });

  it('returns a recoverable structured export failure when the file write fails', async () => {
    mocks.writeAsStringAsync.mockRejectedValueOnce(new Error('disk full'));

    const result = await createStatementStructuredExport(buildDraft());

    expect(result).toMatchObject({
      success: false,
      format: 'structured',
      code: 'write_failed',
    });
  });

  it('creates PDF files through expo print and saves the generated file locally', async () => {
    const result = await createStatementPdfExport(buildDraft(), {
      generatedAt: '2026-06-06T00:00:00.000Z',
    });

    expect(result.success).toBe(true);
    expect(result.filePath).toMatch(/SafeRide_Statement_draft-statement-1_2026-06-06T00-00-00-000Z\.pdf$/);
    expect(mocks.printToFileAsync).toHaveBeenCalledTimes(1);
    expect(mocks.printToFileAsync.mock.calls[0][0].html).toContain('Saved statement text from the active draft.');
    expect(mocks.copyAsync).toHaveBeenCalledWith({
      from: 'file:///cache/printed.pdf',
      to: result.filePath,
    });
  });

  it('reports share failures without claiming the export was shared', async () => {
    mocks.share.mockRejectedValueOnce(new Error('share unavailable'));

    const result = await shareStatementExportFile('file:///docs/statement.pdf', 'SafeRide statement PDF');

    expect(result).toMatchObject({
      success: false,
      shared: false,
    });
  });

  it('keeps Android statement exports local-only instead of claiming a text share delivered the file', async () => {
    const result = await shareStatementExportFile(
      'file:///docs/statement.pdf',
      'SafeRide statement PDF',
      {
        platformOS: 'android',
        getContentUriAsync: mocks.getContentUriAsync,
        share: mocks.share,
        sharedAction: 'sharedAction',
        dismissedAction: 'dismissedAction',
      },
    );

    expect(result).toMatchObject({
      success: true,
      shared: false,
      localOnly: true,
      unavailable: true,
    });
    expect(mocks.getContentUriAsync).not.toHaveBeenCalled();
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it('uses explicit local-only copy for Android share-gated exports', () => {
    const notice = getStatementExportShareNotice('PDF', 'statement.pdf', {
      success: true,
      shared: false,
      localOnly: true,
      unavailable: true,
      unavailableReason: 'Android statement file sharing is not enabled in this build. The file was saved locally only.',
    });

    expect(notice).toMatchObject({
      title: 'File saved locally',
      variant: 'info',
    });
    expect(notice.message).toContain('SafeRide local storage');
    expect(notice.message).toContain('Android statement file sharing is not enabled');
    expect(notice.message).not.toContain('Sharing was canceled');
  });

  it('does not mutate the saved draft while building export content', () => {
    const draft = buildDraft();
    const before = JSON.stringify(draft);

    buildStatementExportPayload(draft);

    expect(JSON.stringify(draft)).toBe(before);
  });
});
