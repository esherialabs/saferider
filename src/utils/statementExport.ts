import { Platform, Share } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Print from 'expo-print';
import { DraftData } from './draftStorage';
import { buildStatementReviewFromDraft } from './statementReview';
import { devPrivacyError, devPrivacyWarn, getPrivacySafeErrorReason } from './privacyLog';

export type StatementExportFormat = 'pdf' | 'structured';

export type StatementExportErrorCode =
  | 'missing_draft_data'
  | 'file_system_unavailable'
  | 'pdf_generation_failed'
  | 'write_failed';

export class StatementExportError extends Error {
  code: StatementExportErrorCode;

  constructor(code: StatementExportErrorCode, message: string) {
    super(message);
    this.name = 'StatementExportError';
    this.code = code;
  }
}

export interface StatementEvidenceMetadata {
  id: string;
  type: 'photo' | 'audio' | 'video' | 'document';
  fileName: string;
  size: number;
  capturedAt: string | null;
  description: string | null;
  mimeType: string | null;
  checksum: string | null;
  hasTranscript: boolean;
  transcriptWordCount: number;
}

export interface StatementExportPayload {
  exportMetadata: {
    schema: 'com.saferide.statement-export';
    version: '1.0.0';
    generatedAt: string;
    exportType: 'statement';
    localOnly: true;
    shareBehavior: string;
    reviewNote: string;
  };
  draft: {
    id: string;
    createdAt: string | null;
    updatedAt: string | null;
    status: DraftData['status'] | null;
    currentStep: string | null;
  };
  statement: {
    text: string;
    wordCount: number;
    readingTimeMinutes: number;
    sources: string[];
    tags: string[];
  };
  incident: {
    description: string | null;
    impactLevel: DraftData['impactLevel'] | null;
    impactSummary: string | null;
    witnesses: boolean | null;
    witnessDetails: string | null;
    immediateHelp: boolean | null;
    date: string | null;
    time: string | null;
    timeAccuracy: NonNullable<DraftData['datetime']>['accuracy'] | null;
    duration: string | null;
    isOngoing: boolean | null;
    location: {
      description: string | null;
      address: string | null;
      type: string | null;
      coordinates: { latitude: number; longitude: number } | null;
    };
  };
  evidenceManifest: StatementEvidenceMetadata[];
  privacySettings: DraftData['privacySettings'] | null;
}

export interface StatementExportBuildOptions {
  generatedAt?: string;
}

export interface StatementFileExportResult {
  success: boolean;
  format: StatementExportFormat;
  fileName?: string;
  filePath?: string;
  size?: number;
  payload?: StatementExportPayload;
  error?: string;
  code?: StatementExportErrorCode;
}

export interface StatementShareResult {
  success: boolean;
  shared: boolean;
  dismissed?: boolean;
  localOnly?: boolean;
  unavailable?: boolean;
  unavailableReason?: string;
  error?: string;
}

export interface StatementExportShareNotice {
  title: string;
  message: string;
  variant: 'success' | 'warning' | 'info';
  duration: number;
}

type StatementExportFileSystem = {
  documentDirectory: string | null;
  writeAsStringAsync: typeof FileSystem.writeAsStringAsync;
  copyAsync: typeof FileSystem.copyAsync;
  getInfoAsync: typeof FileSystem.getInfoAsync;
};

type StatementExportPrint = {
  printToFileAsync: typeof Print.printToFileAsync;
};

type StatementShareDeps = {
  platformOS: typeof Platform.OS;
  getContentUriAsync: typeof FileSystem.getContentUriAsync;
  share: typeof Share.share;
  sharedAction: typeof Share.sharedAction;
  dismissedAction?: typeof Share.dismissedAction;
};

const ANDROID_LOCAL_ONLY_SHARE_REASON =
  'Android statement file sharing is not enabled in this build. The file was saved locally only.';

const DEFAULT_SHARE_BEHAVIOR =
  'Generated on this device. File sharing is offered only where SafeRide can hand off the generated file.';

const DEFAULT_REVIEW_NOTE =
  'This is a saved draft export for personal review. It is not legal advice, provider submission, or a court filing.';

export function buildStatementExportPayload(
  draft: DraftData | null | undefined,
  options: StatementExportBuildOptions = {},
): StatementExportPayload {
  if (!draft) {
    throw new StatementExportError(
      'missing_draft_data',
      'No saved draft data is available for statement export.',
    );
  }

  const statement = buildStatementReviewFromDraft(draft);
  if (!statement) {
    throw new StatementExportError(
      'missing_draft_data',
      'Add saved statement text, incident details, or transcript-backed text before exporting.',
    );
  }

  return {
    exportMetadata: {
      schema: 'com.saferide.statement-export',
      version: '1.0.0',
      generatedAt: options.generatedAt ?? new Date().toISOString(),
      exportType: 'statement',
      localOnly: true,
      shareBehavior: DEFAULT_SHARE_BEHAVIOR,
      reviewNote: DEFAULT_REVIEW_NOTE,
    },
    draft: {
      id: draft.id,
      createdAt: toIsoString(draft.createdAt),
      updatedAt: toIsoString(draft.updatedAt),
      status: draft.status ?? null,
      currentStep: draft.currentStep ?? null,
    },
    statement: {
      text: statement.content,
      wordCount: statement.wordCount,
      readingTimeMinutes: statement.readingTime,
      sources: statement.sources,
      tags: statement.tags,
    },
    incident: {
      description: valueOrNull(draft.incidentDescription),
      impactLevel: draft.impactLevel ?? null,
      impactSummary: valueOrNull(draft.impactSummary),
      witnesses: typeof draft.witnesses === 'boolean' ? draft.witnesses : null,
      witnessDetails: valueOrNull(draft.witnessDetails),
      immediateHelp: typeof draft.immediateHelp === 'boolean' ? draft.immediateHelp : null,
      date: valueOrNull(draft.datetime?.date),
      time: valueOrNull(draft.datetime?.time),
      timeAccuracy: draft.datetime?.accuracy ?? null,
      duration: valueOrNull(draft.duration),
      isOngoing: typeof draft.isOngoing === 'boolean' ? draft.isOngoing : null,
      location: {
        description: valueOrNull(draft.location?.description),
        address: valueOrNull(draft.location?.address),
        type: valueOrNull(draft.location?.type),
        coordinates: draft.location?.coordinates
          ? {
              latitude: draft.location.coordinates.latitude,
              longitude: draft.location.coordinates.longitude,
            }
          : null,
      },
    },
    evidenceManifest: buildEvidenceManifest(draft),
    privacySettings: draft.privacySettings ?? null,
  };
}

export async function createStatementStructuredExport(
  draft: DraftData | null | undefined,
  options: StatementExportBuildOptions = {},
  fileSystem: StatementExportFileSystem = defaultFileSystem(),
): Promise<StatementFileExportResult> {
  try {
    const payload = buildStatementExportPayload(draft, options);
    const fileName = buildStatementFileName(payload.draft.id, 'json', payload.exportMetadata.generatedAt);
    const filePath = buildDocumentFilePath(fileSystem.documentDirectory, fileName);
    const json = JSON.stringify(payload, null, 2);

    await fileSystem.writeAsStringAsync(filePath, json);
    const info = await fileSystem.getInfoAsync(filePath);

    return {
      success: true,
      format: 'structured',
      fileName,
      filePath,
      size: info.exists && !info.isDirectory ? info.size : undefined,
      payload,
    };
  } catch (error) {
    return handleExportError(error, 'structured');
  }
}

export async function createStatementPdfExport(
  draft: DraftData | null | undefined,
  options: StatementExportBuildOptions = {},
  fileSystem: StatementExportFileSystem = defaultFileSystem(),
  print: StatementExportPrint = defaultPrint(),
): Promise<StatementFileExportResult> {
  try {
    const payload = buildStatementExportPayload(draft, options);
    const fileName = buildStatementFileName(payload.draft.id, 'pdf', payload.exportMetadata.generatedAt);
    const filePath = buildDocumentFilePath(fileSystem.documentDirectory, fileName);
    const html = buildStatementExportHtml(payload);
    const printed = await print.printToFileAsync({ html });

    await fileSystem.copyAsync({ from: printed.uri, to: filePath });
    const info = await fileSystem.getInfoAsync(filePath);

    return {
      success: true,
      format: 'pdf',
      fileName,
      filePath,
      size: info.exists && !info.isDirectory ? info.size : undefined,
      payload,
    };
  } catch (error) {
    return handleExportError(error, 'pdf');
  }
}

export async function shareStatementExportFile(
  filePath: string,
  title: string,
  deps: StatementShareDeps = defaultShareDeps(),
): Promise<StatementShareResult> {
  try {
    if (deps.platformOS === 'android') {
      return {
        success: true,
        shared: false,
        localOnly: true,
        unavailable: true,
        unavailableReason: ANDROID_LOCAL_ONLY_SHARE_REASON,
      };
    }

    const shareUri = filePath;

    const result = await deps.share(
      { url: shareUri, message: title },
    );

    if (result.action === deps.sharedAction) {
      return { success: true, shared: true };
    }

    if (deps.dismissedAction && result.action === deps.dismissedAction) {
      return { success: true, shared: false, dismissed: true };
    }

    return { success: true, shared: false };
  } catch (error) {
    devPrivacyError('statement export share failed', { reason: getPrivacySafeErrorReason(error) });
    return {
      success: false,
      shared: false,
      error: 'The file was created locally, but the share sheet did not open.',
    };
  }
}

export function getStatementExportShareNotice(
  formatLabel: string,
  fileName: string,
  shareResult: StatementShareResult,
): StatementExportShareNotice {
  if (!shareResult.success) {
    return {
      title: 'File saved locally',
      message: `${fileName} was created in SafeRide local storage, but sharing did not open. Export again if you need to share it.`,
      variant: 'warning',
      duration: 5500,
    };
  }

  if (shareResult.shared) {
    return {
      title: 'Export ready',
      message: `${formatLabel} created from the saved draft and handed to the selected share option.`,
      variant: 'success',
      duration: 4500,
    };
  }

  if (shareResult.unavailable) {
    return {
      title: 'File saved locally',
      message: `${fileName} was created in SafeRide local storage. ${shareResult.unavailableReason ?? 'Sharing is not enabled on this device.'}`,
      variant: 'info',
      duration: 5500,
    };
  }

  return {
    title: 'File saved locally',
    message: `${fileName} was created on this device. Sharing was canceled.`,
    variant: 'info',
    duration: 4500,
  };
}

export function buildStatementExportHtml(payload: StatementExportPayload): string {
  const evidenceRows = payload.evidenceManifest.length
    ? payload.evidenceManifest.map(item => `
        <tr>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(item.fileName)}</td>
          <td>${escapeHtml(formatBytes(item.size))}</td>
          <td>${escapeHtml(item.checksum ?? 'Not recorded')}</td>
          <td>${escapeHtml(item.hasTranscript ? `${item.transcriptWordCount} words` : 'No')}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="5">No evidence metadata saved in this draft.</td></tr>';

  const tags = payload.statement.tags.length
    ? payload.statement.tags.map(tag => `<span class="tag">${escapeHtml(formatTagLabel(tag))}</span>`).join('')
    : '<span class="muted">No tags saved.</span>';

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; padding: 32px; }
          h1 { font-size: 24px; margin: 0 0 6px; }
          h2 { font-size: 16px; margin: 28px 0 10px; border-bottom: 1px solid #d1d5db; padding-bottom: 6px; }
          p { font-size: 12px; line-height: 1.5; }
          .meta { color: #4b5563; font-size: 11px; margin: 2px 0; }
          .statement { white-space: pre-wrap; border: 1px solid #d1d5db; padding: 14px; border-radius: 8px; font-size: 13px; line-height: 1.55; }
          .notice { background: #f3f4f6; border: 1px solid #d1d5db; padding: 10px; border-radius: 8px; margin-top: 16px; }
          .tag { display: inline-block; border: 1px solid #9ca3af; border-radius: 999px; padding: 3px 8px; margin: 0 4px 4px 0; font-size: 11px; }
          .muted { color: #6b7280; }
          table { width: 100%; border-collapse: collapse; font-size: 11px; }
          th, td { border: 1px solid #d1d5db; padding: 7px; text-align: left; vertical-align: top; }
          th { background: #f9fafb; }
        </style>
      </head>
      <body>
        <h1>SafeRide Statement Export</h1>
        <div class="meta">Draft ID: ${escapeHtml(payload.draft.id)}</div>
        <div class="meta">Generated: ${escapeHtml(payload.exportMetadata.generatedAt)}</div>
        <div class="meta">Draft updated: ${escapeHtml(payload.draft.updatedAt ?? 'Unknown')}</div>

        <div class="notice">
          <p>${escapeHtml(payload.exportMetadata.reviewNote)}</p>
          <p>${escapeHtml(payload.exportMetadata.shareBehavior)}</p>
        </div>

        <h2>Statement</h2>
        <div class="statement">${escapeHtml(payload.statement.text)}</div>
        <p class="meta">${payload.statement.wordCount} words, about ${payload.statement.readingTimeMinutes} minute(s) to read.</p>

        <h2>Tags</h2>
        <p>${tags}</p>

        <h2>Incident Details</h2>
        <p><strong>Date/time:</strong> ${escapeHtml(formatDateTime(payload))}</p>
        <p><strong>Location:</strong> ${escapeHtml(formatLocation(payload))}</p>
        <p><strong>Impact:</strong> ${escapeHtml(payload.incident.impactSummary ?? payload.incident.impactLevel ?? 'Not recorded')}</p>
        <p><strong>Witnesses:</strong> ${escapeHtml(formatWitness(payload))}</p>

        <h2>Evidence Metadata</h2>
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>File name</th>
              <th>Size</th>
              <th>Checksum</th>
              <th>Transcript</th>
            </tr>
          </thead>
          <tbody>${evidenceRows}</tbody>
        </table>
      </body>
    </html>
  `;
}

function buildEvidenceManifest(draft: DraftData): StatementEvidenceMetadata[] {
  return (draft.mediaFiles ?? []).map(file => {
    const transcript = file.transcript?.trim() ?? '';
    return {
      id: file.id,
      type: file.type,
      fileName: file.fileName,
      size: file.size,
      capturedAt: toIsoString(file.timestamp),
      description: valueOrNull(file.description),
      mimeType: valueOrNull(file.mimeType),
      checksum: valueOrNull(file.checksum),
      hasTranscript: transcript.length > 0,
      transcriptWordCount: countWords(transcript),
    };
  });
}

function defaultFileSystem(): StatementExportFileSystem {
  return {
    documentDirectory: FileSystem.documentDirectory,
    writeAsStringAsync: FileSystem.writeAsStringAsync,
    copyAsync: FileSystem.copyAsync,
    getInfoAsync: FileSystem.getInfoAsync,
  };
}

function defaultPrint(): StatementExportPrint {
  return {
    printToFileAsync: Print.printToFileAsync,
  };
}

function defaultShareDeps(): StatementShareDeps {
  return {
    platformOS: Platform.OS,
    getContentUriAsync: FileSystem.getContentUriAsync,
    share: Share.share,
    sharedAction: Share.sharedAction,
    dismissedAction: Share.dismissedAction,
  };
}

function buildDocumentFilePath(documentDirectory: string | null, fileName: string): string {
  if (!documentDirectory) {
    throw new StatementExportError(
      'file_system_unavailable',
      'Local file storage is unavailable on this device.',
    );
  }

  return `${documentDirectory}${fileName}`;
}

function buildStatementFileName(draftId: string, extension: 'json' | 'pdf', generatedAt: string): string {
  const safeDraftId = draftId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'draft';
  const safeTimestamp = generatedAt.replace(/[:.]/g, '-');
  return `SafeRide_Statement_${safeDraftId}_${safeTimestamp}.${extension}`;
}

function handleExportError(error: unknown, format: StatementExportFormat): StatementFileExportResult {
  if (error instanceof StatementExportError) {
    return {
      success: false,
      format,
      code: error.code,
      error: error.message,
    };
  }

  const code: StatementExportErrorCode = format === 'pdf' ? 'pdf_generation_failed' : 'write_failed';
  const message = format === 'pdf'
    ? 'Could not create the statement PDF. Please try again.'
    : 'Could not create the structured statement file. Please try again.';

  devPrivacyWarn('statement export failed', { reason: getPrivacySafeErrorReason(error), format });
  return {
    success: false,
    format,
    code,
    error: message,
  };
}

function valueOrNull(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function toIsoString(value?: Date | string | null): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatTagLabel(tag: string): string {
  return tag
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return 'Unknown';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 102.4) / 10} KB`;
  return `${Math.round(size / (1024 * 102.4)) / 10} MB`;
}

function formatDateTime(payload: StatementExportPayload): string {
  const parts = [
    payload.incident.date,
    payload.incident.time,
    payload.incident.timeAccuracy ? `(${payload.incident.timeAccuracy})` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : 'Not recorded';
}

function formatLocation(payload: StatementExportPayload): string {
  const location = payload.incident.location;
  const parts = [location.description, location.address, location.type].filter(Boolean);
  if (location.coordinates) {
    parts.push(`${location.coordinates.latitude}, ${location.coordinates.longitude}`);
  }
  return parts.length ? parts.join(', ') : 'Not recorded';
}

function formatWitness(payload: StatementExportPayload): string {
  if (payload.incident.witnesses === true) {
    return payload.incident.witnessDetails ?? 'Witnesses recorded without details.';
  }
  if (payload.incident.witnesses === false) {
    return 'No witnesses recorded.';
  }
  return 'Not recorded';
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
