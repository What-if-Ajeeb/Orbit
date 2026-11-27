import { listOllamaModels } from './ollama';
import { saveAiSettings, type AiSettings } from './settings';

/**
 * Ensures local Ollama settings have a concrete model name.
 *
 * Fresh installs intentionally leave `model` empty so discovery owns the
 * choice. Before the first chat call we list installed models, pick the
 * first, and persist it so later turns stay stable without a Settings visit.
 */
export async function resolveLocalOllamaSettings(
  settings: AiSettings,
  options: { signal?: AbortSignal; persist?: boolean } = {}
): Promise<AiSettings> {
  if (settings.provider !== 'ollama') {
    return settings;
  }

  if (settings.model.trim()) {
    return settings;
  }

  const models = await listOllamaModels(settings.baseUrl, {
    signal: options.signal,
  });

  if (models.length === 0) {
    throw new Error(
      'Ollama is reachable but no model is installed on this device. Install one with `ollama pull`, then open Settings → AI.'
    );
  }

  const next: AiSettings = {
    ...settings,
    model: models[0].name,
  };

  if (options.persist !== false) {
    try {
      await saveAiSettings(next);
    } catch (error) {
      console.warn('Could not persist the discovered Ollama model.', error);
    }
  }

  return next;
}
