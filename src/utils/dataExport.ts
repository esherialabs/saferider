import * as FileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';

import { draftStorage } from './draftStorage';
import { offlineSyncManager } from './offlineSync';
import { devPrivacyError, devPrivacyWarn, getPrivacySafeErrorReason } from './privacyLog';

export interface ExportOptions {
  includeMedia?: boolean;
  includeMetadata?: boolean;
  redactionLevel?: 'none' | 'light' | 'heavy';
  format?: 'json' | 'pdf' | 'sealed';
  password?: string;
}

export interface ExportResult {
  success: boolean;
  filePath?: string;
  error?: string;
  size?: number;
}

export const CASE_EXPORT_UNAVAILABLE_MESSAGE =
  'Protected case export is not available in this build.';

class DataExportManager {
  public async exportCase(_caseId: string, _options: ExportOptions = {}): Promise<ExportResult> {
    return this.failClosed();
  }

  public async exportMultipleCases(
    _caseIds: string[],
    _options: ExportOptions = {},
  ): Promise<ExportResult> {
    return this.failClosed();
  }

  public async exportAllData(_options: ExportOptions = {}): Promise<ExportResult> {
    return this.failClosed();
  }

  public async shareUnavailableFile(_filePath: string, _title = 'Exported Data'): Promise<boolean> {
    devPrivacyWarn('case export share unavailable');
    return false;
  }

  public async importData(): Promise<{ success: boolean; imported: number; errors: string[] }> {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/json', 'application/octet-stream'],
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return { success: false, imported: 0, errors: ['Import cancelled'] };
      }

      const asset = result.assets[0];
      const fileContent = await FileSystem.readAsStringAsync(asset.uri);
      const importData = JSON.parse(fileContent);

      return await this.processImportData(importData);
    } catch (error) {
      devPrivacyError('data import failed', { reason: getPrivacySafeErrorReason(error) });
      return { success: false, imported: 0, errors: ['Unable to import data.'] };
    }
  }

  private failClosed(): ExportResult {
    devPrivacyWarn('case export unavailable');
    return { success: false, error: CASE_EXPORT_UNAVAILABLE_MESSAGE };
  }

  private async processImportData(
    importData: any,
  ): Promise<{ success: boolean; imported: number; errors: string[] }> {
    const errors: string[] = [];
    let imported = 0;

    try {
      if (!this.validateImportData(importData)) {
        return { success: false, imported: 0, errors: ['Invalid import data format'] };
      }

      if (importData.cases) {
        for (const caseData of importData.cases) {
          try {
            await this.importCase(caseData);
            imported++;
          } catch (error) {
            errors.push(`Failed to import case ${caseData.id}: ${(error as Error).message}`);
          }
        }
      }

      if (importData.drafts) {
        for (const draft of importData.drafts) {
          try {
            await draftStorage.saveDraft(draft);
            imported++;
          } catch (error) {
            errors.push(`Failed to import draft ${draft.id}: ${(error as Error).message}`);
          }
        }
      }

      return {
        success: imported > 0,
        imported,
        errors,
      };
    } catch (error) {
      return { success: false, imported, errors: [...errors, (error as Error).message] };
    }
  }

  private async importCase(caseData: any): Promise<void> {
    await offlineSyncManager.storeOfflineData(`imported_case_${caseData.id}`, caseData, false);
  }

  private validateImportData(data: any): boolean {
    return data && (data.cases || data.drafts || data.exportMetadata);
  }
}

export const dataExportManager = new DataExportManager();

export const exportCase = dataExportManager.exportCase.bind(dataExportManager);
export const exportMultipleCases = dataExportManager.exportMultipleCases.bind(dataExportManager);
export const exportAllData = dataExportManager.exportAllData.bind(dataExportManager);
export const shareFile = dataExportManager.shareUnavailableFile.bind(dataExportManager);
export const importData = dataExportManager.importData.bind(dataExportManager);
