import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { normalizeOllamaBaseUrl, ON_DEVICE_OLLAMA_BASE_URL } from './ollama';

export { ON_DEVICE_OLLAMA_BASE_URL } from './ollama';

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
  /** Opt-in for automatic web tools. Older saved settings default to enabled. */
  webSearch?: boolean;
  /** Artifact previews may load scripts from cdnjs.cloudflare.com. Default off. */
  artifactCdnjsAllowed?: boolean;
};

/**
 * Ollama running on this same device via its native HTTP API.
 * The model is intentionally empty: `/api/tags` must discover what is installed.
 */
export function onDeviceOllamaSettings(): AiSettings {
  return {
    provider: 'ollama',
    mode: 'local',
    baseUrl: ON_DEVICE_OLLAMA_BASE_URL,
    model: '',
    apiKey: '',
    webSearch: true,
    artifactCdnjsAllowed: false,
  };
}

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
  ollama: {
    id: 'ollama',
    adapterId: 'ollama-native',
    label: 'On-device (Ollama)',
    shortLabel: 'System',
    baseUrl: ON_DEVICE_OLLAMA_BASE_URL,
    model: '',
    keyHint: 'not needed',
    docsUrl: 'https://github.com/ollama/ollama/blob/main/docs/api.md',
    note: 'Default Orbit AI path. Uses models already on this phone. No API key. Model list is discovered from /api/tags.',
    requiresApiKey: false,
  },
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
    note: 'DeepSeek-V4 compatible models. Recommended for cloud Orbit.',
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
};

/** Local / system AI first — cloud is opt-in. */
export const PROVIDER_ORDER: AiProvider[] = [
  'ollama',
  'deepseek',
  'openai',
  'gemini',
  'anthropic',
  'mistral',
  'huggingface',
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
  return onDeviceOllamaSettings();
}

function normalizeSettings(value: Partial<AiSettings> | null): AiSettings {
  const provider =
    value?.provider && value.provider in PROVIDER_PRESETS ? value.provider : 'ollama';
  const preset = PROVIDER_PRESETS[provider];
  // Older builds stored Ollama without a mode; treat it as a local server.
  const mode: AiConnectionMode =
    provider === 'ollama' || (value?.mode === 'local' && LOCAL_PROVIDER_ORDER.includes(provider))
      ? 'local'
      : 'cloud';

  const rawBaseUrl = (value?.baseUrl ?? preset.baseUrl).trim();
  // Migrate the old OpenAI-compatible `/v1` Ollama default to the native API.
  const baseUrl =
    provider === 'ollama' ? normalizeOllamaBaseUrl(rawBaseUrl) || preset.baseUrl : rawBaseUrl;

  return {
    provider,
    mode,
    baseUrl,
    model: (value?.model ?? preset.model).trim(),
    apiKey: (value?.apiKey ?? '').trim(),
    webSearch: value?.webSearch !== false,
    artifactCdnjsAllowed: value?.artifactCdnjsAllowed === true,
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

/** Persists the artifact CDN opt-in without disturbing provider settings. */
export async function setArtifactCdnjsAllowed(enabled: boolean): Promise<AiSettings> {
  const settings = await loadAiSettings();
  return saveAiSettings({ ...settings, artifactCdnjsAllowed: enabled === true });
}

export async function clearAiSettings(): Promise<void> {
  if (Platform.OS === 'web') {
    getWebStorage()?.removeItem(SETTINGS_KEY);
    return;
  }

  await SecureStore.deleteItemAsync(SETTINGS_KEY);
}

/**
 * Whether Orbit may attempt a model call for this configuration.
 *
 * System-first rule: on-device Ollama only needs a reachable local URL. The
 * model name is discovered at request time from `/api/tags`, so an empty model
 * must not force the user into "API key missing" local command mode.
 * Cloud providers still require a key (and model) as before.
 */
export function isAiConfigured(settings: AiSettings): boolean {
  const baseUrl = settings.baseUrl.trim();

  if (!baseUrl) {
    return false;
  }

  if (settings.mode === 'local' || settings.provider === 'ollama') {
    // Local path: URL alone is enough. Model may be filled by discovery.
    return /^https?:\/\//i.test(baseUrl);
  }

  if (!settings.model.trim()) {
    return false;
  }

  return !PROVIDER_PRESETS[settings.provider].requiresApiKey || settings.apiKey.trim().length > 0;
}

/** True when settings point at the default on-device Ollama endpoint. */
export function isOnDeviceOllama(settings: AiSettings): boolean {
  if (settings.provider !== 'ollama' && settings.mode !== 'local') {
    return false;
  }

  const normalized = normalizeOllamaBaseUrl(settings.baseUrl);
  return (
    normalized === ON_DEVICE_OLLAMA_BASE_URL ||
    normalized === 'http://localhost:11434'
  );
}

export function applyProviderPreset(settings: AiSettings, provider: AiProvider): AiSettings {
  const preset = PROVIDER_PRESETS[provider];

  return {
    ...settings,
    provider,
    mode: provider === 'ollama' ? 'local' : settings.mode === 'local' && provider === 'custom' ? 'local' : 'cloud',
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
