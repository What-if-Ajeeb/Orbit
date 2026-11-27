import { listOllamaModels, OllamaRequestError } from './ollama';
import { saveAiSettings, type AiSettings } from './settings';

/** Reachability probe — intentionally shorter than chat timeout. */
export const OLLAMA_RESOLVE_TIMEOUT_MS = 2_000;

/**
 * Ensures local Ollama settings have a concrete model name and that the
 * server is reachable.
 *
 * Fresh installs leave `model` empty so discovery owns the choice. Before the
 * first chat call we list installed models (2s timeout), pick one, and persist
 * it. If Ollama is offline this throws quickly instead of blocking on the chat
 * timeout so the Hermes system fallback can take over.
 */
export async function resolveLocalOllamaSettings(
  settings: AiSettings,
  options: { signal?: AbortSignal; persist?: boolean; timeoutMs?: number } = {}
): Promise<AiSettings> {
  if (settings.provider !== 'ollama') {
    return settings;
  }

  const timeoutMs = options.timeoutMs ?? OLLAMA_RESOLVE_TIMEOUT_MS;

  let models;
  try {
    models = await listOllamaModels(settings.baseUrl, {
      signal: options.signal,
      timeoutMs,
      retries: 0,
    });
  } catch (error) {
    if (error instanceof OllamaRequestError) {
      if (error.code === 'cancelled') throw error;
      throw new Error(
        'Ollama is not reachable on this device right now. Start Ollama (or pull a model), or use system task commands. Cloud API key is optional.'
      );
    }
    throw error;
  }

  if (models.length === 0) {
    throw new Error(
      'Ollama is running but no model is installed. Run `ollama pull <model>` on this device, then try again.'
    );
  }

  const preferred = settings.model.trim();
  if (preferred && models.some((model) => model.name === preferred)) {
    return settings;
  }

  const next: AiSettings = {
    ...settings,
    model: preferred && models.some((m) => m.name === preferred) ? preferred : models[0].name,
  };

  // Prefer the previously saved model only when it is still installed; otherwise
  // take the first available and persist so Settings stays in sync.
  if (options.persist !== false && next.model !== preferred) {
    try {
      await saveAiSettings(next);
    } catch (error) {
      console.warn('Could not persist the discovered Ollama model.', error);
    }
  }

  return next;
}
