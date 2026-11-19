import type { AiSettings } from './settings';
import type { LlmMessage, LlmToolDefinition, LlmTurn } from './types';

/**
 * A provider plugin speaks one wire protocol. Presets in `settings.ts` point at
 * an adapter id, so multiple presets (OpenAI, OpenRouter, custom) can share a
 * single adapter without the agent knowing which one is active.
 */
export type ProviderCompletionRequest = {
  settings: AiSettings;
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
};

export type AiProviderAdapter = {
  id: string;
  label: string;
  complete: (request: ProviderCompletionRequest) => Promise<LlmTurn>;
};

type RegisterOptions = {
  /** Replace an adapter with the same id instead of throwing. */
  replace?: boolean;
};

export class AiProviderRegistry {
  private adapters = new Map<string, AiProviderAdapter>();

  register(adapter: AiProviderAdapter, options: RegisterOptions = {}): void {
    if (!adapter.id.trim()) {
      throw new Error('A provider adapter needs a non-empty id.');
    }

    if (!options.replace && this.adapters.has(adapter.id)) {
      throw new Error(`AI provider adapter "${adapter.id}" is already registered.`);
    }

    this.adapters.set(adapter.id, adapter);
  }

  unregister(id: string): boolean {
    return this.adapters.delete(id);
  }

  get(id: string): AiProviderAdapter | null {
    return this.adapters.get(id) ?? null;
  }

  list(): AiProviderAdapter[] {
    return Array.from(this.adapters.values());
  }
}

export const aiProviderRegistry = new AiProviderRegistry();
