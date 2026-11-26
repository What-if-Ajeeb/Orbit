import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyConnectionMode,
  isAiConfigured,
  loadAiSettings,
  onDeviceOllamaSettings,
  PROVIDER_PRESETS,
  saveAiSettings,
} from './settings';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

type MemoryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function setWebStorage(storage: MemoryStorage): void {
  (globalThis as { localStorage?: MemoryStorage }).localStorage = storage;
}

describe('AI settings', () => {
  beforeEach(() => {
    setWebStorage(memoryStorage());
  });

  it('defaults fresh installs to native Ollama without inventing a model', async () => {
    const settings = await loadAiSettings();

    expect(settings).toEqual(onDeviceOllamaSettings());
    expect(settings.provider).toBe('ollama');
    expect(settings.mode).toBe('local');
    expect(settings.baseUrl).toBe('http://127.0.0.1:11434');
    expect(settings.model).toBe('');
    expect(settings.apiKey).toBe('');
    expect(isAiConfigured(settings)).toBe(false);
  });

  it('uses the native adapter for the Ollama preset', () => {
    const preset = PROVIDER_PRESETS.ollama;
    const defaults = onDeviceOllamaSettings();

    expect(preset.adapterId).toBe('ollama-native');
    expect(preset.baseUrl).toBe(defaults.baseUrl);
    expect(preset.model).toBe('');
    expect(preset.requiresApiKey).toBe(false);
  });

  it('migrates the old /v1 Ollama URL to the native API', async () => {
    const saved = await saveAiSettings({
      provider: 'ollama',
      mode: 'local',
      baseUrl: 'http://127.0.0.1:11434/v1',
      model: 'discovered-model',
      apiKey: '',
    });

    expect(saved.baseUrl).toBe('http://127.0.0.1:11434');
    expect((await loadAiSettings()).baseUrl).toBe('http://127.0.0.1:11434');
  });

  it('persists the Web Search opt-out with the chat settings', async () => {
    const saved = await saveAiSettings({
      provider: 'ollama',
      mode: 'local',
      baseUrl: 'http://127.0.0.1:11434',
      model: 'local-model',
      apiKey: '',
      webSearch: false,
    });

    expect(saved.webSearch).toBe(false);
    expect((await loadAiSettings()).webSearch).toBe(false);
  });

  it('persists custom settings and can switch back to Ollama', async () => {
    const saved = await saveAiSettings({
      provider: 'openai',
      mode: 'cloud',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1-mini',
      apiKey: 'sk-test',
    });
    expect((await loadAiSettings()).apiKey).toBe(saved.apiKey);

    const local = await saveAiSettings(applyConnectionMode(saved, 'local'));
    expect(local.provider).toBe('ollama');
    expect(local.baseUrl).toBe('http://127.0.0.1:11434');
    expect(local.model).toBe('');
  });
});
