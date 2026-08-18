import { z } from 'zod';

const PLACEHOLDER_PATTERN = /^(replace|change|your|todo|example|placeholder|xxx)/i;

function isRealValue(value: string): boolean {
  return value.trim().length > 0 && !PLACEHOLDER_PATTERN.test(value.trim());
}

function isValidUrl(value: string): boolean {
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

const requiredString = z
  .string()
  .trim()
  .min(1)
  .refine(isRealValue, 'must not be a placeholder value');

const requiredUrl = z
  .string()
  .trim()
  .url()
  .refine(isRealValue, 'must not be a placeholder value');

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform(value => (value && isRealValue(value) ? value : undefined));

const optionalUrl = optionalString.refine(
  value => value === undefined || isValidUrl(value),
  'must be a valid URL',
);

const optionalStringList = z.array(requiredString).optional().default([]);
const optionalPositiveInteger = z.number().int().positive().optional();
const optionalNonNegativeInteger = z.number().int().nonnegative().optional();
const requiredSha256 = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/i, 'must be a 64-character SHA-256 hex digest')
  .transform(value => value.toLowerCase());

const localAssistantArtifactSchema = z.object({
  fileName: requiredString,
  downloadUrl: requiredUrl,
  sha256: requiredSha256,
  sizeBytes: z.number().int().positive(),
  contextWindow: optionalPositiveInteger,
  gpuLayers: optionalNonNegativeInteger,
  vramRequiredMb: optionalPositiveInteger,
});

export const runtimeEnvSchema = z.object({
  environment: z.enum(['local', 'development', 'staging', 'production', 'test']),
  buildProfile: optionalString,
  releaseLike: z.boolean().optional().default(false),
  releaseEndpointHosts: optionalStringList,
  releaseStorageHosts: optionalStringList,
  apiBaseUrl: requiredUrl,
  apiTimeoutMs: z.number().int().positive(),
  wsBaseUrl: requiredUrl,
  authBaseUrl: requiredUrl,
  storageBaseUrl: requiredUrl,
  runtimeConfigUrl: optionalUrl,
  configRefreshSeconds: z.number().int().positive(),
  openAIEnabled: z.boolean(),
  localAssistant: z.object({
    enabled: z.boolean(),
    preferOnDevice: z.boolean(),
    modelId: requiredString,
    allowRealLiteRtLmRuntime: z.boolean().optional().default(false),
    qaTunedArtifactManifestId: optionalString,
    artifact: localAssistantArtifactSchema.optional(),
  }),
  measurement: z.object({
    moderatedTestMode: z.boolean().optional().default(false),
    controlVersion: optionalString,
  }),
  azureOpenAI: z.object({
    transcriptionEnabled: z.boolean(),
    endpoint: optionalUrl,
    deployment: optionalString,
    apiVersion: optionalString,
  }),
});

export type RuntimeEnv = z.infer<typeof runtimeEnvSchema>;
