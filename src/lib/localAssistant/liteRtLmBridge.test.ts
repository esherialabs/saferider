import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  __setSafeRideLiteRtLmNativeModuleForTests,
  createSafeRideLiteRtLmBridgeConfig,
  cancelSafeRideLiteRtLmBridge,
  generateSafeRideLiteRtLmResponse,
  getSafeRideLiteRtLmBridgeStatus,
  isLiteRtLmModelConfig,
  loadSafeRideLiteRtLmBridge,
  prepareSafeRideLiteRtLmBridge,
  unloadSafeRideLiteRtLmBridge,
} from './liteRtLmBridge';
import { GEMMA_4_E2B_LITERTLM_CONFIG, type LocalModelConfig } from './modelRegistry';

vi.mock('react-native', () => ({
  NativeModules: {},
  Platform: { OS: 'android' },
}));

function mockNativeModule() {
  return {
    getStatus: vi.fn(async () => ({
      state: 'idle' as const,
      runtimeAvailable: false,
      mockMode: false,
    })),
    prepare: vi.fn(async () => ({
      state: 'prepared' as const,
      runtimeAvailable: false,
      mockMode: true,
      modelId: GEMMA_4_E2B_LITERTLM_CONFIG.id,
      manifestId: GEMMA_4_E2B_LITERTLM_CONFIG.manifestId,
    })),
    load: vi.fn(async () => ({
      state: 'loaded' as const,
      runtimeAvailable: false,
      mockMode: true,
      modelId: GEMMA_4_E2B_LITERTLM_CONFIG.id,
      manifestId: GEMMA_4_E2B_LITERTLM_CONFIG.manifestId,
    })),
    generate: vi.fn(async () => ({
      content: 'The mock bridge is callable.',
      sourceLabel: 'SafeRide local AI',
      modelId: GEMMA_4_E2B_LITERTLM_CONFIG.id,
      manifestId: GEMMA_4_E2B_LITERTLM_CONFIG.manifestId,
      mockMode: true,
    })),
    cancel: vi.fn(async () => ({
      state: 'loaded' as const,
      runtimeAvailable: false,
      mockMode: true,
    })),
    unload: vi.fn(async () => ({
      state: 'idle' as const,
      runtimeAvailable: false,
      mockMode: false,
    })),
  };
}

describe('SafeRide LiteRT-LM bridge', () => {
  beforeEach(() => {
    __setSafeRideLiteRtLmNativeModuleForTests(undefined);
  });

  it('reports unavailable when the Android native module is absent', async () => {
    __setSafeRideLiteRtLmNativeModuleForTests(null);

    await expect(getSafeRideLiteRtLmBridgeStatus()).resolves.toMatchObject({
      state: 'unavailable',
      nativeAvailable: false,
      runtimeAvailable: false,
    });
  });

  it('creates a controlled Gemma 4 bridge config from the manifest-backed registry entry', () => {
    const config = createSafeRideLiteRtLmBridgeConfig(GEMMA_4_E2B_LITERTLM_CONFIG, {
      modelPath: 'file:///models/gemma-4-E2B-it.litertlm',
      mockMode: true,
    });

    expect(isLiteRtLmModelConfig(GEMMA_4_E2B_LITERTLM_CONFIG)).toBe(true);
    expect(config).toMatchObject({
      modelId: 'litert-community/gemma-4-E2B-it-litert-lm',
      manifestId: 'litert-community-gemma-4-e2b-litertlm-prototype-2026-06-29.1',
      modelPath: 'file:///models/gemma-4-E2B-it.litertlm',
      mockMode: true,
      allowRealRuntime: false,
      maxOutputTokens: 128,
      expectedFileName: 'gemma-4-E2B-it.litertlm',
      expectedSizeBytes: 2_588_147_712,
      expectedSha256: '181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c',
      contextWindow: 2048,
      backendPlan: ['gpu', 'cpu-text'],
      cachePolicy: 'app-cache',
      systemPrompt: expect.stringContaining('SafeRide on-device assistant'),
    });
  });

  it('refuses to create a LiteRT-LM bridge config for legacy GGUF models', () => {
    const legacyGgufConfig = {
      ...GEMMA_4_E2B_LITERTLM_CONFIG,
      label: 'Retired GGUF model',
      runtime: {
        kind: 'llama-rn-gguf',
        modelId: 'retired-gguf',
        modelFileName: 'model.gguf',
        contextWindow: 2048,
        gpuLayers: 0,
      },
    } as unknown as LocalModelConfig;

    expect(isLiteRtLmModelConfig(legacyGgufConfig)).toBe(false);
    expect(() => createSafeRideLiteRtLmBridgeConfig(legacyGgufConfig)).toThrow(
      'not a LiteRT-LM model config',
    );
  });

  it('refuses non-.litertlm model paths before crossing the native bridge', () => {
    expect(() => createSafeRideLiteRtLmBridgeConfig(GEMMA_4_E2B_LITERTLM_CONFIG, {
      modelPath: 'file:///models/gemma-4-E2B-it.gguf',
    })).toThrow('.litertlm model path');
  });

  it('rejects unsafe manifest, storage, and file paths before crossing the native bridge', () => {
    const unsafeConfig = {
      ...GEMMA_4_E2B_LITERTLM_CONFIG,
      manifestId: '../outside',
      storageDir: 'manifests/../outside',
    };
    expect(() => createSafeRideLiteRtLmBridgeConfig(unsafeConfig)).toThrow('invalid local model identity');
    expect(() => createSafeRideLiteRtLmBridgeConfig(GEMMA_4_E2B_LITERTLM_CONFIG, {
      modelPath: 'file:///models/../gemma-4-E2B-it.litertlm',
    })).toThrow('model path is invalid');
  });

  it('can prepare, load, generate, and unload through the CI-safe mock native bridge', async () => {
    const native = mockNativeModule();
    __setSafeRideLiteRtLmNativeModuleForTests(native);
    const config = createSafeRideLiteRtLmBridgeConfig(GEMMA_4_E2B_LITERTLM_CONFIG, {
      mockMode: true,
    });

    await expect(prepareSafeRideLiteRtLmBridge(config)).resolves.toMatchObject({
      state: 'prepared',
      nativeAvailable: true,
      mockMode: true,
    });
    await expect(loadSafeRideLiteRtLmBridge(config)).resolves.toMatchObject({
      state: 'loaded',
      nativeAvailable: true,
      mockMode: true,
    });
    await expect(generateSafeRideLiteRtLmResponse([
      { role: 'user', content: 'synthetic bridge smoke' },
    ])).resolves.toMatchObject({
      content: 'The mock bridge is callable.',
      mockMode: true,
    });
    await expect(cancelSafeRideLiteRtLmBridge()).resolves.toMatchObject({
      state: 'loaded',
      nativeAvailable: true,
      mockMode: true,
    });
    await expect(unloadSafeRideLiteRtLmBridge()).resolves.toMatchObject({
      state: 'idle',
      nativeAvailable: true,
    });

    expect(native.prepare).toHaveBeenCalledWith(config);
    expect(native.load).toHaveBeenCalledWith(config);
    expect(native.generate).toHaveBeenCalledWith([
      { role: 'user', content: 'synthetic bridge smoke' },
    ], undefined);
    expect(native.cancel).toHaveBeenCalledTimes(1);
  });

  it('rejects empty native responses instead of treating them as model evidence', async () => {
    const native = mockNativeModule();
    native.generate.mockResolvedValueOnce({
      content: '',
      sourceLabel: 'SafeRide local AI',
      modelId: GEMMA_4_E2B_LITERTLM_CONFIG.id,
      manifestId: GEMMA_4_E2B_LITERTLM_CONFIG.manifestId,
      mockMode: true,
    });
    __setSafeRideLiteRtLmNativeModuleForTests(native);

    await expect(generateSafeRideLiteRtLmResponse([{ role: 'user', content: 'hi' }])).rejects.toThrow(
      'empty response',
    );
  });
});
