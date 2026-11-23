import { Service, type Context } from 'cordis';

import { aiProviderRegistry } from '@/lib/ai/provider-registry';
import type { AiProviderAdapter } from '@/lib/ai/provider-registry';
import { geminiAdapter, ollamaAdapter, openAiAdapter } from '@/lib/ai/providers';

/**
 * LLM adapter registry plugin. Mounting Orbit adapters moves the static
 * `aiProviderRegistry.register()` call sites into spine boot, so external
 * providers (DeepSeek, OpenRouter, custom) can call `ctx.llm.register()`.
 */
export class OrbitLlm extends Service<OrbitLlm> {
  static readonly name = 'llm';

  constructor(ctx: Context) {
    super(ctx, 'llm');

    // Mount the built-in adapters now that registration lives behind ctx.llm.
    aiProviderRegistry.register(openAiAdapter, { replace: true });
    aiProviderRegistry.register(geminiAdapter, { replace: true });
    aiProviderRegistry.register(ollamaAdapter, { replace: true });
  }

  register(adapter: AiProviderAdapter): void {
    aiProviderRegistry.register(adapter, { replace: true });
  }

  unregister(id: string): boolean {
    return aiProviderRegistry.unregister(id);
  }

  list(): AiProviderAdapter[] {
    return aiProviderRegistry.list();
  }

  get(id: string): AiProviderAdapter | null {
    return aiProviderRegistry.get(id);
  }
}
