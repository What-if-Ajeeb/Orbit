import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type AiProvider =
  | 'deepseek'
  | 'openai'
  | 'gemini'
  | 'anthropic'
  | 'mistral'
  | 'huggingface'
  | 'ollama'
  | 'openrouter'
  | 'custom';

/** Cloud providers need a key; a local server is reachable by URL alone. */
export type AiConnectionMode = 'cloud' | 'local';

export type AiSettings = {
  provider: AiProvider;
  mode: AiConnectionMode;
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
  /** Cloud presets need a key; local presets work with just a URL and model. */
  requiresApiKey: boolean;
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
    requiresApiKey: true,
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
    requiresApiKey: true,
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
    requiresApiKey: true,
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
    requiresApiKey: true,
  },
  deepseek: {
    id: 'deepseek',
    adapterId: 'openai-compatible',
    label: 'DeepSeek',
    shortLabel: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
    keyHint: 'sk-...',
    docsUrl: 'https://platform.deepseek.com/api-keys',
    note: 'DeepSeek-V4 compatible models. Recommended for Orbit.',
    requiresApiKey: true,
  },
  anthropic: {
    id: 'anthropic',
    adapterId: 'openai-compatible',
    label: 'Anthropic',
    shortLabel: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    model: 'claude-3-5-sonnet-20241022',
    keyHint: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/',
    note: 'Claude models via OpenAI-compatible proxy (e.g. LiteLLM).',
    requiresApiKey: true,
  },
  mistral: {
    id: 'mistral',
    adapterId: 'openai-compatible',
    label: 'Mistral',
    shortLabel: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    model: 'mistral-large-latest',
    keyHint: '...',
    docsUrl: 'https://console.mistral.ai/',
    note: 'Mistral AI ke models via OpenAI-compatible endpoint.',
    requiresApiKey: true,
  },
  huggingface: {
    id: 'huggingface',
    adapterId: 'openai-compatible',
    label: 'Hugging Face',
    shortLabel: 'HF',
    baseUrl: 'https://api-inference.huggingface.co/v1/',
    model: '',
    keyHint: 'hf_...',
    docsUrl: 'https://huggingface.co/docs/huggingface_hub/v0.14.0/package_reference/inference_client#huggingface_hub.InferenceClient.chat_completion',
    note: 'Hugging Face Inference API. Model naam manually दें।',
    requiresApiKey: true,
  },
  ollama: {
    id: 'ollama',
    adapterId: 'openai-compatible',
    label: 'Ollama',
    shortLabel: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    model: 'llama3',
    keyHint: 'optional',
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
    note: 'Local Ollama server. No API key needed; use your computer IP on the phone.',
    requiresApiKey: false,
  },
};

export const PROVIDER_ORDER: AiProvider[] = [
  'deepseek',
  'openai',
  'gemini',
  'anthropic',
  'mistral',
  'huggingface',
  'ollama',
  'openrouter',
  'custom',
];

export const CLOUD_PROVIDER_ORDER: AiProvider[] = PROVIDER_ORDER.filter(
  (provider) => provider !== 'ollama'
);

export const LOCAL_PROVIDER_ORDER: AiProvider[] = ['ollama', 'custom'];

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
    mode: 'cloud',
    baseUrl: preset.baseUrl,
    model: preset.model,
    apiKey: '',
  };
}

function normalizeSettings(value: Partial<AiSettings> | null): AiSettings {
  const provider =
    value?.provider && value.provider in PROVIDER_PRESETS ? value.provider : 'openai';
  const preset = PROVIDER_PRESETS[provider];
  // Older builds stored Ollama without a mode; treat it as a local server.
  const mode: AiConnectionMode =
    provider === 'ollama' || (value?.mode === 'local' && LOCAL_PROVIDER_ORDER.includes(provider))
      ? 'local'
      : 'cloud';

  return {
    provider,
    mode,
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
  const baseUrl = settings.baseUrl.trim();

  if (!baseUrl || !settings.model.trim()) {
    return false;
  }

  if (settings.mode === 'local') {
    return /^https?:\/\//i.test(baseUrl);
  }

  return !PROVIDER_PRESETS[settings.provider].requiresApiKey || settings.apiKey.trim().length > 0;
}

export function applyProviderPreset(settings: AiSettings, provider: AiProvider): AiSettings {
  const preset = PROVIDER_PRESETS[provider];

  return {
    ...settings,
    provider,
    baseUrl: preset.baseUrl,
    model: preset.model,
  };
}

export function applyConnectionMode(
  settings: AiSettings,
  mode: AiConnectionMode
): AiSettings {
  if (mode === settings.mode) {
    return settings;
  }

  let provider = settings.provider;

  if (mode === 'local' && !LOCAL_PROVIDER_ORDER.includes(provider)) {
    provider = 'ollama';
  }

  if (mode === 'cloud' && provider === 'ollama') {
    provider = 'openai';
  }

  return { ...applyProviderPreset(settings, provider), mode };
}
