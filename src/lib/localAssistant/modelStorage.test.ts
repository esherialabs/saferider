import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { LocalModelConfig } from './modelRegistry';
import { TUNED_ARTIFACT_CONTROLS, type TunedArtifactControls } from './tunedArtifactControls';
import {
  cancelActiveModelDownload,
  ensureModelAvailability,
  getModelAvailability,
  getModelDirectory,
  getSavedModelDownloadProgress,
  inspectModelAvailability,
  ModelDownloadCancelledError,
  ModelDownloadPausedError,
  pauseActiveModelDownload,
  MODEL_DOWNLOAD_STATE_KEY_PREFIX,
  MODEL_VERIFICATION_STATE_KEY_PREFIX,
  removeModelArtifacts,
  sha256FileInChunks,
  validateLargeModelDownloadAuthorization,
} from './modelStorage';

type DownloadTaskMock = {
  downloadAsync: ReturnType<typeof vi.fn>;
  resumeAsync: ReturnType<typeof vi.fn>;
  pauseAsync: ReturnType<typeof vi.fn>;
  savable: ReturnType<typeof vi.fn>;
};

type FileHandleMock = {
  readBytes: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const fileSystemMock = vi.hoisted(() => ({
  files: new Map<string, number>(),
  directories: new Set<string>(),
  tasks: [] as DownloadTaskMock[],
  downloads: [] as Array<{
    url: string;
    fileUri: string;
    resumeData?: string;
    mode: 'download' | 'resume';
    options: Record<string, unknown>;
  }>,
  completeDownload: false,
  downloadStatus: 200,
  resumeStatus: 200,
  pauseResumeData: 'saved-resume-data' as string | undefined,
  freeDiskStorageBytes: 3 * 1024 * 1024 * 1024,
  writtenByteScale: 1,
  fileContents: new Map<string, Uint8Array>(),
  checksumReadError: null as Error | null,
  fileHandles: [] as FileHandleMock[],
}));

vi.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'file:///safeRide/',
  cacheDirectory: 'file:///safeRide/cache/',
  EncodingType: { Base64: 'base64' },
  FileSystemSessionType: { BACKGROUND: 'BACKGROUND' },
  getInfoAsync: vi.fn(async (uri: string) => {
    const size = fileSystemMock.files.get(uri);
    return size === undefined
      ? { exists: false, uri, isDirectory: false }
      : { exists: true, uri, isDirectory: false, size, modificationTime: 0 };
  }),
  makeDirectoryAsync: vi.fn(async (uri: string) => {
    fileSystemMock.directories.add(uri);
  }),
  getFreeDiskStorageAsync: vi.fn(async () => fileSystemMock.freeDiskStorageBytes),
  readAsStringAsync: vi.fn(async () => ''),
  writeAsStringAsync: vi.fn(async (uri: string, contents: string, options?: { append?: boolean }) => {
    const currentSize = options?.append ? fileSystemMock.files.get(uri) ?? 0 : 0;
    const padding = contents.endsWith('==') ? 2 : contents.endsWith('=') ? 1 : 0;
    const nextSize = Math.floor((Math.floor((contents.length * 3) / 4) - padding) * fileSystemMock.writtenByteScale);
    fileSystemMock.files.set(uri, currentSize + nextSize);
  }),
  deleteAsync: vi.fn(async (uri: string) => {
    if (uri.endsWith('/')) {
      for (const file of fileSystemMock.files.keys()) {
        if (file.startsWith(uri)) fileSystemMock.files.delete(file);
      }
    } else {
      fileSystemMock.files.delete(uri);
    }
  }),
  createDownloadResumable: vi.fn((
    url: string,
    fileUri: string,
    options: Record<string, unknown>,
    callback?: (event: { totalBytesWritten: number; totalBytesExpectedToWrite: number }) => void,
    resumeData?: string,
  ) => {
    const task: DownloadTaskMock = {
      downloadAsync: vi.fn(async () => {
        fileSystemMock.downloads.push({ url, fileUri, options, resumeData, mode: 'download' });
        callback?.({ totalBytesWritten: 40, totalBytesExpectedToWrite: 100 });
        fileSystemMock.files.set(fileUri, 40);
        if (fileSystemMock.completeDownload) {
          callback?.({ totalBytesWritten: 100, totalBytesExpectedToWrite: 100 });
          fileSystemMock.files.set(fileUri, 100);
          return { uri: fileUri, status: fileSystemMock.downloadStatus, headers: {}, mimeType: null };
        }
        return new Promise(() => {});
      }),
      resumeAsync: vi.fn(async () => {
        fileSystemMock.downloads.push({ url, fileUri, options, resumeData, mode: 'resume' });
        callback?.({ totalBytesWritten: 100, totalBytesExpectedToWrite: 100 });
        fileSystemMock.files.set(fileUri, 100);
        return { uri: fileUri, status: fileSystemMock.resumeStatus, headers: {}, mimeType: null };
      }),
      pauseAsync: vi.fn(async () => ({
        url,
        fileUri,
        options,
        resumeData: fileSystemMock.pauseResumeData,
      })),
      savable: vi.fn(() => ({ url, fileUri, options, resumeData })),
    };
    fileSystemMock.tasks.push(task);
    return task;
  }),
}));

vi.mock('expo-file-system', () => ({
  FileMode: { ReadOnly: 'r' },
  File: class MockFile {
    private readonly uri: string;

    constructor(uri: string) {
      this.uri = uri;
    }

    open() {
      let offset = 0;
      const handle: FileHandleMock = {
        readBytes: vi.fn((length: number) => {
          if (fileSystemMock.checksumReadError) {
            throw fileSystemMock.checksumReadError;
          }
          const size = fileSystemMock.files.get(this.uri)
            ?? fileSystemMock.fileContents.get(this.uri)?.byteLength
            ?? 0;
          const readLength = Math.min(length, Math.max(0, size - offset));
          const contents = fileSystemMock.fileContents.get(this.uri);
          const bytes = contents
            ? contents.slice(offset, offset + readLength)
            : new Uint8Array(readLength);
          offset += bytes.byteLength;
          return bytes;
        }),
        close: vi.fn(),
      };
      fileSystemMock.fileHandles.push(handle);
      return handle;
    }
  },
}));

function testModelConfig(sizeBytes: number | null = 100): LocalModelConfig {
  return {
    id: 'test-model',
    label: 'Test model',
    variant: 'test/model',
    providerFamily: 'gemma',
    manifestId: 'test-manifest',
    runtime: {
      kind: 'litert-lm',
      modelId: 'test-model',
      modelFileName: 'model.litertlm',
      contextWindow: 128,
      maxOutputTokens: 64,
      backendPlan: ['cpu-text'],
      cachePolicy: 'app-cache',
    },
    storageDir: 'test-model',
    files: [
      {
        fileName: 'model.litertlm',
        downloadUrl: 'https://models.example/model.litertlm',
        ...(sizeBytes === null ? {} : { sizeBytes }),
      },
    ],
    systemPrompt: 'Test prompt',
    capabilities: {
      textGeneration: true,
      audioTranscription: false,
      offenceTagging: false,
    },
  };
}

function rangeResponse(status: number, contentRange: string | null, byteLength: number): Response {
  return {
    status,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-range' ? contentRange : null),
    },
    arrayBuffer: async () => new Uint8Array(byteLength).buffer,
  } as unknown as Response;
}

function getRequestHeader(init: RequestInit | undefined, name: string): string | null {
  const headers = init?.headers;
  if (!headers) return null;
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  return (headers as Record<string, string>)[name] ?? null;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error('Timed out waiting for async condition');
}

describe('local assistant model storage', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    fileSystemMock.files.clear();
    fileSystemMock.directories.clear();
    fileSystemMock.tasks.length = 0;
    fileSystemMock.downloads.length = 0;
    fileSystemMock.completeDownload = false;
    fileSystemMock.downloadStatus = 200;
    fileSystemMock.resumeStatus = 200;
    fileSystemMock.pauseResumeData = 'saved-resume-data';
    fileSystemMock.freeDiskStorageBytes = 3 * 1024 * 1024 * 1024;
    fileSystemMock.writtenByteScale = 1;
    fileSystemMock.fileContents.clear();
    fileSystemMock.checksumReadError = null;
    fileSystemMock.fileHandles.length = 0;
  });

  it('downloads known-size model files with durable HTTP ranges from the first byte', async () => {
    const config = testModelConfig();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(getRequestHeader(init, 'Range')).toBe('bytes=0-99');
      return rangeResponse(206, 'bytes 0-99/100', 100);
    });
    vi.stubGlobal('fetch', fetchMock);

    const progress: number[] = [];
    await ensureModelAvailability(config, event => {
      progress.push(event.receivedBytes);
    });

    expect(fileSystemMock.downloads).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fileSystemMock.files.get('file:///safeRide/models/test-model/model.litertlm')).toBe(100);
    expect(progress).toEqual([0, 100]);
    await expect(AsyncStorage.getItem(`${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`)).resolves.toBeNull();
  });

  it('rejects unsafe storage identities before file-system access', () => {
    const config = testModelConfig();
    config.storageDir = 'manifests/../outside';

    expect(() => getModelDirectory(config)).toThrow('Local model storage identity is invalid');
  });

  it('rejects range responses whose total is not the manifest-approved size', async () => {
    const config = testModelConfig();
    vi.stubGlobal('fetch', vi.fn(async () => rangeResponse(206, 'bytes 0-99/101', 100)));

    await expect(ensureModelAvailability(config)).rejects.toThrow('Invalid range response');
    expect(fileSystemMock.files.get('file:///safeRide/models/test-model/model.litertlm')).toBeUndefined();
  });

  it('rejects range responses that omit the approved total', async () => {
    const config = testModelConfig();
    vi.stubGlobal('fetch', vi.fn(async () => rangeResponse(206, 'bytes 0-99/*', 100)));

    await expect(ensureModelAvailability(config)).rejects.toThrow('Invalid range response');
    expect(fileSystemMock.files.get('file:///safeRide/models/test-model/model.litertlm')).toBeUndefined();
  });

  it('hashes files in bounded byte chunks', async () => {
    fileSystemMock.files.set('file:///safeRide/model.bin', 4);
    fileSystemMock.fileContents.set('file:///safeRide/model.bin', new Uint8Array([116, 101, 115, 116]));

    const progress: number[] = [];
    await expect(sha256FileInChunks('file:///safeRide/model.bin', 4, 3, verifiedBytes => {
      progress.push(verifiedBytes);
    })).resolves.toBe(
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    );
    expect(progress).toEqual([0, 3, 4]);
    expect(fileSystemMock.fileHandles).toHaveLength(1);
    expect(fileSystemMock.fileHandles[0].readBytes).toHaveBeenNthCalledWith(1, 3);
    expect(fileSystemMock.fileHandles[0].readBytes).toHaveBeenNthCalledWith(2, 1);
    expect(fileSystemMock.fileHandles[0].close).toHaveBeenCalledTimes(1);
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();
  });

  it('recognizes a complete local file before verification and reuses persisted checksum proof', async () => {
    const config = testModelConfig(4);
    config.files[0].sha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    const target = 'file:///safeRide/models/test-model/model.litertlm';
    fileSystemMock.files.set(target, 4);
    fileSystemMock.fileContents.set(target, new Uint8Array([116, 101, 115, 116]));

    await expect(inspectModelAvailability(config)).resolves.toMatchObject({
      downloaded: true,
      complete: false,
      invalid: false,
      files: [{ state: 'downloaded' }],
    });
    expect(FileSystem.readAsStringAsync).not.toHaveBeenCalled();

    const verificationProgress: Array<{ phase?: string; receivedBytes: number }> = [];
    await expect(getModelAvailability(config, progress => {
      verificationProgress.push({ phase: progress.phase, receivedBytes: progress.receivedBytes });
    })).resolves.toMatchObject({
      downloaded: true,
      complete: true,
      invalid: false,
      files: [{ state: 'complete' }],
    });
    expect(verificationProgress).toEqual([
      { phase: 'verify', receivedBytes: 0 },
      { phase: 'verify', receivedBytes: 4 },
    ]);
    await expect(AsyncStorage.getItem(
      `${MODEL_VERIFICATION_STATE_KEY_PREFIX}test-model:model.litertlm`,
    )).resolves.toContain('"expectedSha256"');

    const openedHandleCount = fileSystemMock.fileHandles.length;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await ensureModelAvailability(config);
    await expect(getModelAvailability(config)).resolves.toMatchObject({
      downloaded: true,
      complete: true,
      files: [{ state: 'complete' }],
    });
    expect(fileSystemMock.fileHandles).toHaveLength(openedHandleCount);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to checksum verification when persisted verification metadata cannot be read', async () => {
    const config = testModelConfig(4);
    config.files[0].sha256 = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
    const target = 'file:///safeRide/models/test-model/model.litertlm';
    fileSystemMock.files.set(target, 4);
    fileSystemMock.fileContents.set(target, new Uint8Array([116, 101, 115, 116]));
    vi.mocked(AsyncStorage.getItem).mockRejectedValueOnce(new Error('verification cache unavailable'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(ensureModelAvailability(config)).resolves.toBeUndefined();

    expect(fileSystemMock.fileHandles).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(fileSystemMock.files.get(target)).toBe(4);
  });

  it('fails closed when an exact-size file has the wrong SHA-256', async () => {
    const sizeBytes = 4;
    const config = testModelConfig(sizeBytes);
    config.files[0].sha256 = 'a'.repeat(64);
    const target = 'file:///safeRide/models/test-model/model.litertlm';
    fileSystemMock.files.set(target, sizeBytes);
    fileSystemMock.fileContents.set(target, new Uint8Array([116, 101, 115, 116]));

    await expect(getModelAvailability(config)).resolves.toMatchObject({
      complete: false,
      files: [{ state: 'invalid' }],
    });
    expect(fileSystemMock.fileHandles).toHaveLength(1);
  });

  it('preserves a complete multi-gigabyte file when checksum reading fails', async () => {
    const sizeBytes = 5_071_837_136;
    const config = testModelConfig(sizeBytes);
    config.files[0].sha256 = 'a'.repeat(64);
    const target = 'file:///safeRide/models/test-model/model.litertlm';
    fileSystemMock.files.set(target, sizeBytes);
    fileSystemMock.checksumReadError = new Error('synthetic native read failure');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(ensureModelAvailability(config)).rejects.toThrow(
      'Could not read model.litertlm for checksum verification.',
    );

    expect(fileSystemMock.files.get(target)).toBe(sizeBytes);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('persists range download progress when the active model download is paused', async () => {
    const rangeChunkSize = 4 * 1024 * 1024;
    const totalSize = rangeChunkSize * 2;
    const config = testModelConfig(totalSize);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const range = getRequestHeader(init, 'Range');
      if (range === `bytes=0-${rangeChunkSize - 1}`) {
        return rangeResponse(206, `bytes 0-${rangeChunkSize - 1}/${totalSize}`, rangeChunkSize);
      }

      if (range === `bytes=${rangeChunkSize}-${totalSize - 1}`) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            reject(error);
          });
        });
      }

      throw new Error(`Unexpected range request: ${range}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = ensureModelAvailability(config).catch(error => error);
    await waitFor(() => fetchMock.mock.calls.length >= 2);

    await expect(pauseActiveModelDownload()).resolves.toBe(true);

    const error = await pending;
    expect(error).toBeInstanceOf(ModelDownloadPausedError);
    const persisted = await AsyncStorage.getItem(`${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`);

    expect(persisted).toContain(`"receivedBytes":${rangeChunkSize}`);
    expect(fileSystemMock.files.get('file:///safeRide/models/test-model/model.litertlm')).toBe(rangeChunkSize);
    await expect(getModelAvailability(config)).resolves.toMatchObject({
      partial: true,
      resumable: true,
      receivedBytes: rangeChunkSize,
    });
  });

  it('cancels an active range download and removes partial data and resume state', async () => {
    const rangeChunkSize = 4 * 1024 * 1024;
    const totalSize = rangeChunkSize * 2;
    const config = testModelConfig(totalSize);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const range = getRequestHeader(init, 'Range');
      if (range === `bytes=0-${rangeChunkSize - 1}`) {
        return rangeResponse(206, `bytes 0-${rangeChunkSize - 1}/${totalSize}`, rangeChunkSize);
      }
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        });
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    const pending = ensureModelAvailability(config).catch(error => error);
    await waitFor(() => fetchMock.mock.calls.length >= 2);
    await expect(cancelActiveModelDownload()).resolves.toBe(true);

    expect(await pending).toBeInstanceOf(ModelDownloadCancelledError);
    expect(fileSystemMock.files.has('file:///safeRide/models/test-model/model.litertlm')).toBe(false);
    await expect(AsyncStorage.getItem(`${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`)).resolves.toBeNull();
  });

  it('persists native pause progress even when Android does not provide native resume data', async () => {
    const config = testModelConfig(null);
    fileSystemMock.pauseResumeData = undefined;
    const pending = ensureModelAvailability(config).catch(error => error);

    for (let attempt = 0; attempt < 10 && fileSystemMock.tasks.length === 0; attempt += 1) {
      await Promise.resolve();
    }

    await expect(pauseActiveModelDownload()).resolves.toBe(true);

    const error = await pending;
    expect(error).toBeInstanceOf(ModelDownloadPausedError);
    const persisted = await AsyncStorage.getItem(`${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`);
    const parsed = JSON.parse(persisted ?? '{}') as { pauseState?: { resumeData?: string }; progress?: { receivedBytes?: number } };

    expect(parsed.pauseState?.resumeData).toBeUndefined();
    expect(parsed.progress?.receivedBytes).toBe(40);
  });

  it('resumes native saved download state for model files without a known size', async () => {
    const config = testModelConfig(null);
    await AsyncStorage.setItem(
      `${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`,
      JSON.stringify({
        schema: 'com.saferide.local-model-download-state',
        version: 1,
        modelId: 'test-model',
        fileName: 'model.litertlm',
        expectedSizeBytes: 100,
        progress: { receivedBytes: 40, totalBytes: 100 },
        pauseState: {
          url: 'https://models.example/model.litertlm',
          fileUri: 'file:///safeRide/models/test-model/model.litertlm',
          options: { sessionType: 'BACKGROUND' },
          resumeData: 'saved-resume-data',
        },
        savedAt: new Date().toISOString(),
      }),
    );

    const progress: number[] = [];
    await ensureModelAvailability(config, event => {
      progress.push(event.receivedBytes);
    });

    expect(fileSystemMock.downloads.at(-1)).toMatchObject({
      mode: 'resume',
      resumeData: 'saved-resume-data',
    });
    expect(progress).toEqual([40, 100]);
    await expect(AsyncStorage.getItem(`${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`)).resolves.toBeNull();
  });

  it('honors native resume data for known-size files when no partial target file is visible', async () => {
    const config = testModelConfig();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await AsyncStorage.setItem(
      `${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`,
      JSON.stringify({
        schema: 'com.saferide.local-model-download-state',
        version: 1,
        modelId: 'test-model',
        fileName: 'model.litertlm',
        expectedSizeBytes: 100,
        pauseState: {
          url: 'https://models.example/model.litertlm',
          fileUri: 'file:///safeRide/models/test-model/model.litertlm',
          options: { sessionType: 'BACKGROUND' },
          resumeData: 'saved-resume-data',
        },
        savedAt: new Date().toISOString(),
      }),
    );

    await expect(getModelAvailability(config)).resolves.toMatchObject({
      partial: true,
      resumable: true,
      receivedBytes: 0,
      totalBytes: 100,
    });

    await ensureModelAvailability(config);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fileSystemMock.downloads.at(-1)).toMatchObject({
      mode: 'resume',
      resumeData: 'saved-resume-data',
    });
    await expect(AsyncStorage.getItem(`${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`)).resolves.toBeNull();
  });

  it('accepts 2xx native resume responses instead of restarting after a partial-content completion', async () => {
    const config = testModelConfig(null);
    fileSystemMock.resumeStatus = 206;
    await AsyncStorage.setItem(
      `${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`,
      JSON.stringify({
        schema: 'com.saferide.local-model-download-state',
        version: 1,
        modelId: 'test-model',
        fileName: 'model.litertlm',
        expectedSizeBytes: 100,
        progress: { receivedBytes: 40, totalBytes: 100 },
        pauseState: {
          url: 'https://models.example/model.litertlm',
          fileUri: 'file:///safeRide/models/test-model/model.litertlm',
          options: { sessionType: 'BACKGROUND' },
          resumeData: 'saved-resume-data',
        },
        savedAt: new Date().toISOString(),
      }),
    );

    await ensureModelAvailability(config);

    expect(fileSystemMock.downloads.at(-1)).toMatchObject({
      mode: 'resume',
      resumeData: 'saved-resume-data',
    });
    await expect(AsyncStorage.getItem(`${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`)).resolves.toBeNull();
  });

  it('reports a partial model file as resumable even without an Expo resume token', async () => {
    const config = testModelConfig();
    fileSystemMock.files.set('file:///safeRide/models/test-model/model.litertlm', 40);

    await expect(getModelAvailability(config)).resolves.toMatchObject({
      complete: false,
      partial: true,
      resumable: true,
      receivedBytes: 40,
      totalBytes: 100,
      files: [
        {
          state: 'partial',
          resumable: true,
          progress: {
            receivedBytes: 40,
            totalBytes: 100,
          },
        },
      ],
    });
  });

  it('continues a partial model file with HTTP ranges when no native resume token exists', async () => {
    const config = testModelConfig();
    fileSystemMock.files.set('file:///safeRide/models/test-model/model.litertlm', 40);
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(getRequestHeader(init, 'Range')).toBe('bytes=40-99');
      return rangeResponse(206, 'bytes 40-99/100', 60);
    });
    vi.stubGlobal('fetch', fetchMock);

    const progress: number[] = [];
    await ensureModelAvailability(config, event => {
      progress.push(event.receivedBytes);
    });

    expect(fileSystemMock.downloads).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fileSystemMock.files.get('file:///safeRide/models/test-model/model.litertlm')).toBe(100);
    expect(progress).toEqual([40, 100]);
    await expect(AsyncStorage.getItem(`${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`)).resolves.toBeNull();
  });

  it('does not restart or append when a server ignores a resume range request', async () => {
    const config = testModelConfig();
    fileSystemMock.files.set('file:///safeRide/models/test-model/model.litertlm', 40);
    vi.stubGlobal('fetch', vi.fn(async () => rangeResponse(200, null, 100)));

    await expect(ensureModelAvailability(config)).rejects.toThrow(
      'Server does not support resumable range download',
    );

    expect(fileSystemMock.downloads).toHaveLength(0);
    expect(fileSystemMock.files.get('file:///safeRide/models/test-model/model.litertlm')).toBe(40);
    const persisted = await AsyncStorage.getItem(`${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`);
    expect(persisted).toContain('"receivedBytes":40');
  });

  it('keeps a short downloaded file resumable instead of deleting progress', async () => {
    const config = testModelConfig();
    fileSystemMock.writtenByteScale = 0.9;
    vi.stubGlobal('fetch', vi.fn(async () => rangeResponse(206, 'bytes 0-99/100', 100)));

    await expect(ensureModelAvailability(config)).rejects.toThrow(
      'Incomplete download for model.litertlm. Progress was saved for resume.',
    );

    expect(fileSystemMock.files.get('file:///safeRide/models/test-model/model.litertlm')).toBe(90);
    const persisted = await AsyncStorage.getItem(`${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`);
    expect(persisted).toContain('"receivedBytes":90');
  });

  it('fails before downloading when device storage is too low', async () => {
    const config = testModelConfig();
    fileSystemMock.freeDiskStorageBytes = 50 * 1024 * 1024;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(ensureModelAvailability(config)).rejects.toThrow('Not enough device storage for model.litertlm');

    expect(fetchMock).not.toHaveBeenCalled();
    expect(fileSystemMock.files.get('file:///safeRide/models/test-model/model.litertlm')).toBeUndefined();
  });

  it('refuses app downloads for controlled-import artifacts while still allowing preseed checks', async () => {
    const config = testModelConfig();
    config.files[0] = {
      ...config.files[0],
      fileName: 'model.litertlm',
      downloadMode: 'controlled-import',
    };

    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(ensureModelAvailability(config)).rejects.toThrow('cannot be downloaded by this build');
    expect(fetchMock).not.toHaveBeenCalled();

    fileSystemMock.files.set('file:///safeRide/models/test-model/model.litertlm', 100);
    await expect(getModelAvailability(config)).resolves.toMatchObject({
      complete: true,
      receivedBytes: 100,
      totalBytes: 100,
    });
  });

  it('does not start a new download when the model file already exists with the expected size', async () => {
    const config = testModelConfig();
    fileSystemMock.files.set('file:///safeRide/models/test-model/model.litertlm', 100);

    await ensureModelAvailability(config);

    expect(fileSystemMock.downloads).toHaveLength(0);
    await expect(getModelAvailability(config)).resolves.toMatchObject({
      complete: true,
      receivedBytes: 100,
      totalBytes: 100,
    });
  });

  it('reports saved progress before a resumed download starts', async () => {
    const config = testModelConfig();
    await AsyncStorage.setItem(
      `${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`,
      JSON.stringify({
        schema: 'com.saferide.local-model-download-state',
        version: 1,
        modelId: 'test-model',
        fileName: 'model.litertlm',
        expectedSizeBytes: 100,
        progress: { receivedBytes: 40, totalBytes: 100 },
        pauseState: {
          url: 'https://models.example/model.litertlm',
          fileUri: 'file:///safeRide/models/test-model/model.litertlm',
          options: { sessionType: 'BACKGROUND' },
          resumeData: 'saved-resume-data',
        },
        savedAt: new Date().toISOString(),
      }),
    );

    await expect(getSavedModelDownloadProgress(config)).resolves.toEqual({
      fileName: 'model.litertlm',
      receivedBytes: 40,
      totalBytes: 100,
      phase: 'download',
    });
  });

  it('requires exact consent and separate metered-network consent for large artifacts', () => {
    const config = testModelConfig(200 * 1024 * 1024);
    config.files[0].sha256 = 'a'.repeat(64);
    const controls = JSON.parse(JSON.stringify(TUNED_ARTIFACT_CONTROLS)) as TunedArtifactControls;
    controls.download.enabled = true;

    expect(validateLargeModelDownloadAuthorization(config, config.files[0], undefined, controls)).toEqual([
      'Exact artifact identity, byte size, and explicit download consent are required.',
    ]);
    const authorization = {
      manifestId: 'test-manifest',
      artifactSha256: 'a'.repeat(64),
      acknowledgedSizeBytes: 200 * 1024 * 1024,
      consentedAt: '2026-07-30T00:00:00.000Z',
      networkType: 'metered' as const,
      meteredNetworkAccepted: false,
    };
    expect(validateLargeModelDownloadAuthorization(config, config.files[0], authorization, controls)).toEqual([
      'Metered-network download requires separate explicit consent.',
    ]);
    expect(validateLargeModelDownloadAuthorization(config, config.files[0], {
      ...authorization,
      meteredNetworkAccepted: true,
    }, controls)).toEqual([]);
  });

  it('keeps large downloads disabled under the checked-in controls and cleans artifacts on revocation', async () => {
    const config = testModelConfig(200 * 1024 * 1024);
    config.files[0].sha256 = 'a'.repeat(64);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(ensureModelAvailability(config, undefined, {
      manifestId: 'test-manifest',
      artifactSha256: 'a'.repeat(64),
      acknowledgedSizeBytes: 200 * 1024 * 1024,
      consentedAt: '2026-07-30T00:00:00.000Z',
      networkType: 'wifi',
      meteredNetworkAccepted: false,
    })).rejects.toThrow('Large local-model downloads are disabled');
    expect(fetchMock).not.toHaveBeenCalled();

    fileSystemMock.files.set('file:///safeRide/models/test-model/model.litertlm', 100);
    await AsyncStorage.setItem(`${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`, 'synthetic-state');
    await AsyncStorage.setItem(`${MODEL_VERIFICATION_STATE_KEY_PREFIX}test-model:model.litertlm`, 'synthetic-state');
    await removeModelArtifacts(config);
    expect(fileSystemMock.files.has('file:///safeRide/models/test-model/model.litertlm')).toBe(false);
    await expect(AsyncStorage.getItem(`${MODEL_DOWNLOAD_STATE_KEY_PREFIX}test-model:model.litertlm`)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(`${MODEL_VERIFICATION_STATE_KEY_PREFIX}test-model:model.litertlm`)).resolves.toBeNull();
  });

  it('allows exact-consent large downloads only for an explicit artifact-produced QA config', () => {
    const config = testModelConfig(200 * 1024 * 1024);
    config.qaOnly = true;
    config.devOnly = true;
    config.lifecycleStatus = 'artifact-produced';
    config.rolloutDownloadMode = 'app-download';
    config.files[0].downloadMode = 'app-download';
    config.files[0].sha256 = 'a'.repeat(64);
    const authorization = {
      manifestId: 'test-manifest',
      artifactSha256: 'a'.repeat(64),
      acknowledgedSizeBytes: 200 * 1024 * 1024,
      consentedAt: '2026-08-13T00:00:00.000Z',
      networkType: 'wifi' as const,
      meteredNetworkAccepted: false,
    };

    expect(validateLargeModelDownloadAuthorization(
      config,
      config.files[0],
      authorization,
      TUNED_ARTIFACT_CONTROLS,
    )).toEqual([]);
    expect(validateLargeModelDownloadAuthorization(
      { ...config, qaOnly: false },
      config.files[0],
      authorization,
      TUNED_ARTIFACT_CONTROLS,
    )).toEqual(['Large local-model downloads are disabled by the active artifact controls.']);
  });
});
