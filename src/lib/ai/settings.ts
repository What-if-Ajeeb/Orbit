import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type AiProvider = 'openai' | 'gemini' | 'openrouter' | 'custom';

export type AiSettings = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
};

export type ProviderPreset = {
  id: AiProvider;
  /** Registered wire-protocol adapter used by this preset. */
  adapterId: string;
  label: string;
  shortLabel: string;
  baseUrl: string;
  model: string;
  keyHint: string;
  docsUrl: string;
  note: string;
};

export const PROVIDER_PRESETS: Record<AiProvider, ProviderPreset> = {
  openai: {
    id: 'openai',
    adapterId: 'openai-compatible',
    label: 'OpenAI',
    shortLabel: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1-mini',
    keyHint: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    note: 'OpenAI ke official models. Key platform.openai.com se milegi.',
  },
  gemini: {
    id: 'gemini',
    adapterId: 'gemini',
    label: 'Google Gemini',
    shortLabel: 'Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.5-flash',
    keyHint: 'AIza...',
    docsUrl: 'https://aistudio.google.com/apikey',
    note: 'Free tier available. Key Google AI Studio se milegi.',
  },
  openrouter: {
    id: 'openrouter',
    adapterId: 'openai-compatible',
    label: 'OpenRouter',
    shortLabel: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4.1-mini',
    keyHint: 'sk-or-...',
    docsUrl: 'https://openrouter.ai/keys',
    note: 'Ek key se kai providers/models — sabse flexible.',
  },
  custom: {
    id: 'custom',
    adapterId: 'openai-compatible',
    label: 'Custom (OpenAI-compatible)',
    shortLabel: 'Custom',
    baseUrl: '',
    model: '',
    keyHint: 'provider key',
    docsUrl: '',
    note: 'Groq, Together, LM Studio ya koi bhi OpenAI-compatible endpoint.',
  },
};

export const PROVIDER_ORDER: AiProvider[] = ['openai', 'gemini', 'openrouter', 'custom'];

const SETTINGS_KEY = 'orbit.ai.settings.v1';

type WebStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function getWebStorage(): WebStorage | null {
  return (globalThis as { localStorage?: WebStorage }).localStorage ?? null;
}

function emptySettings(): AiSettings {
  const preset = PROVIDER_PRESETS.openai;

  return {
    provider: 'openai',
    baseUrl: preset.baseUrl,
    model: preset.model,
    apiKey: '',
  };
}

function normalizeSettings(value: Partial<AiSettings> | null): AiSettings {
  const provider =
    value?.provider && value.provider in PROVIDER_PRESETS ? value.provider : 'openai';
  const preset = PROVIDER_PRESETS[provider];

  return {
    provider,
    baseUrl: (value?.baseUrl ?? preset.baseUrl).trim(),
    model: (value?.model ?? preset.model).trim(),
    apiKey: (value?.apiKey ?? '').trim(),
  };
}

export async function loadAiSettings(): Promise<AiSettings> {
  try {
    if (Platform.OS === 'web') {
      const raw = getWebStorage()?.getItem(SETTINGS_KEY);
      return raw ? normalizeSettings(JSON.parse(raw) as Partial<AiSettings>) : emptySettings();
    }

    const raw = await SecureStore.getItemAsync(SETTINGS_KEY);
    return raw ? normalizeSettings(JSON.parse(raw) as Partial<AiSettings>) : emptySettings();
  } catch (error) {
    console.warn('Could not load AI settings.', error);
    return emptySettings();
  }
}

export async function saveAiSettings(settings: AiSettings): Promise<AiSettings> {
  const normalized = normalizeSettings(settings);
  const raw = JSON.stringify(normalized);

  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(SETTINGS_KEY, raw);
    return normalized;
  }

  await SecureStore.setItemAsync(SETTINGS_KEY, raw);
  return normalized;
}

export async function clearAiSettings(): Promise<void> {
  if (Platform.OS === 'web') {
    getWebStorage()?.removeItem(SETTINGS_KEY);
    return;
  }

  await SecureStore.deleteItemAsync(SETTINGS_KEY);
}

export function isAiConfigured(settings: AiSettings): boolean {
  return (
    settings.apiKey.trim().length > 0 &&
    settings.model.trim().length > 0 &&
    settings.baseUrl.trim().length > 0
  );
}

export function applyProviderPreset(settings: AiSettings, provider: AiProvider): AiSettings {
  const preset = PROVIDER_PRESETS[provider];

  return {
    provider,
    baseUrl: preset.baseUrl,
    model: preset.model,
    apiKey: settings.apiKey,
  };
}
