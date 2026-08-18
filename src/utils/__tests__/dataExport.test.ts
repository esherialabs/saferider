import { beforeEach, describe, expect, it, vi } from 'vitest';

const fileSystemMock = vi.hoisted(() => ({
  readAsStringAsync: vi.fn(),
  writeAsStringAsync: vi.fn(),
}));

vi.mock('expo-file-system/legacy', () => fileSystemMock);

vi.mock('expo-document-picker', () => ({
  getDocumentAsync: vi.fn(),
}));

vi.mock('../offlineSync', () => ({
  offlineSyncManager: {
    storeOfflineData: vi.fn(),
  },
}));

vi.mock('../privacyLog', () => ({
  devPrivacyError: vi.fn(),
  devPrivacyWarn: vi.fn(),
  getPrivacySafeErrorReason: vi.fn(() => 'safe-reason'),
}));

import {
  CASE_EXPORT_UNAVAILABLE_MESSAGE,
  exportAllData,
  exportCase,
  exportMultipleCases,
  shareFile,
} from '../dataExport';

describe('data export release gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fails closed for case export calls without writing files', async () => {
    await expect(exportCase('case-1', { format: 'json' })).resolves.toEqual({
      success: false,
      error: CASE_EXPORT_UNAVAILABLE_MESSAGE,
    });
    await expect(exportMultipleCases(['case-1'], { format: 'pdf' })).resolves.toEqual({
      success: false,
      error: CASE_EXPORT_UNAVAILABLE_MESSAGE,
    });
    await expect(exportAllData({ format: 'sealed' })).resolves.toEqual({
      success: false,
      error: CASE_EXPORT_UNAVAILABLE_MESSAGE,
    });

    expect(fileSystemMock.writeAsStringAsync).not.toHaveBeenCalled();
  });

  it('does not share legacy exported files from the case export helper', async () => {
    await expect(shareFile('file:///docs/case.json', 'Case export')).resolves.toBe(false);
  });
});
