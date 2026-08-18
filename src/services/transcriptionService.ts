import * as FileSystem from 'expo-file-system/legacy';

import { azureOpenAIConfig, isAzureConfigured } from '../config/azureOpenAI';
import { localAssistantConfig } from '../config/localAssistant';
import {
  getLocalAssistantDescriptor,
  getLocalAssistantStatus,
  transcribeWithLocalAssistant,
} from './localAssistantService';
import { devPrivacyWarn, getPrivacySafeErrorReason } from '../utils/privacyLog';

export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

type TranscriptionRequest = {
  uri: string;
  fileName?: string;
};

function ensureEndpoint(endpoint: string): string {
  return endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;
}

function ensureFileUri(uri: string): string {
  if (uri.startsWith('file://')) return uri;
  return `file://${uri}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function ensureFileExists(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    throw new TranscriptionError('Audio file not found at provided URI.');
  }
}

function guessContentType(fileName: string): string {
  const lowered = fileName.toLowerCase();
  if (lowered.endsWith('.wav')) return 'audio/wav';
  if (lowered.endsWith('.m4a')) return 'audio/mp4';
  if (lowered.endsWith('.mp3')) return 'audio/mpeg';
  if (lowered.endsWith('.aac')) return 'audio/aac';
  if (lowered.endsWith('.ogg')) return 'audio/ogg';
  return 'application/octet-stream';
}

export async function transcribeAudio(request: TranscriptionRequest): Promise<string> {
  const normalizedUri = ensureFileUri(request.uri);
  await ensureFileExists(normalizedUri);

  if (localAssistantConfig.enabled) {
    const descriptor = getLocalAssistantDescriptor();
    const status = getLocalAssistantStatus();
    const preferLocal = localAssistantConfig.preferOnDevice || status.state === 'ready';
    if (preferLocal && descriptor.capabilities.audioTranscription) {
      try {
        return await transcribeWithLocalAssistant(normalizedUri, undefined, undefined);
      } catch (error) {
        devPrivacyWarn('local assistant transcription failed; trying configured fallback', {
          reason: getPrivacySafeErrorReason(error),
        });
        if (!isAzureConfigured()) {
          throw error instanceof Error ? error : new Error(String(error));
        }
      }
    }
  }

  if (!isAzureConfigured()) {
    throw new TranscriptionError(
      'No transcription engine configured. Configure the on-device assistant or a backend transcription proxy.',
    );
  }

  const uploadUri = normalizedUri;
  const inferredFileName = request.fileName ?? uploadUri.split('/').pop() ?? 'audio.m4a';
  const contentType = guessContentType(inferredFileName);
  const url = `${ensureEndpoint(azureOpenAIConfig.endpoint)}/openai/deployments/${
    azureOpenAIConfig.deployment
  }/audio/transcriptions?api-version=${encodeURIComponent(azureOpenAIConfig.apiVersion)}`;

  const formData = new FormData();
  formData.append('model', azureOpenAIConfig.deployment);
  formData.append(
    'file',
    {
      uri: uploadUri,
      name: inferredFileName,
      type: contentType,
    } as any,
  );

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${azureOpenAIConfig.apiKey}`,
      'api-key': azureOpenAIConfig.apiKey,
      Accept: 'application/json',
    },
    body: formData,
  });

  const rawBody = await response.text();
  let parsedBody: unknown = undefined;
  if (rawBody.length > 0) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = rawBody;
    }
  }

  if (!response.ok) {
    throw new TranscriptionError(`Transcription failed with status ${response.status}`);
  }

  const successBody = isRecord(parsedBody) ? parsedBody : null;

  if (!successBody) {
    throw new TranscriptionError('Received invalid response from transcription service.');
  }

  const transcript = typeof successBody.text === 'string' ? successBody.text.trim() : undefined;

  if (!transcript) {
    throw new TranscriptionError('No transcript returned from the transcription service.');
  }

  return transcript;
}
