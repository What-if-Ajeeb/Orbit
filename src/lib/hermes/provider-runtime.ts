import { isAiConfigured, PROVIDER_PRESETS, type AiSettings } from '../ai/settings';

import type { ProviderKind, ProviderRoute } from './types';

/**
 * Maps the single saved provider configuration to the adapter route already
 * implemented in `ai/providers.ts`. This is description only: the controller
 * remains the sole caller of `requestCompletion()`.
 */
export function resolveProviderRoute(settings: AiSettings): ProviderRoute {
  const provider = settings.provider;
  const preset = PROVIDER_PRESETS[provider];
  const configured = isAiConfigured(settings);

  let kind: ProviderKind = 'chat-completions';
  if (provider === 'gemini') kind = 'gemini';
  if (provider === 'ollama') kind = 'ollama';

  const base: ProviderRoute = {
    kind: configured ? kind : 'system',
    provider,
    adapterId: configured ? preset?.adapterId ?? 'openai-compatible' : null,
    baseUrl: configured ? settings.baseUrl.trim() : '',
    model: configured ? settings.model.trim() : '',
    configured,
    fallback: false,
  };

  return base;
}

/**
 * A finite chain: the configured provider, then deterministic system work.
 * There is no second network provider because ORBIT stores exactly one active
 * configuration. Secrets are never copied into this structure.
 */
export function buildProviderFallbackChain(settings: AiSettings): ProviderRoute[] {
  const primary = resolveProviderRoute(settings);
  if (!primary.configured) return [{ ...primary, fallback: true }];

  const system: ProviderRoute = {
    kind: 'system',
    provider: primary.provider,
    adapterId: null,
    baseUrl: '',
    model: '',
    configured: false,
    fallback: true,
  };
  return [primary, system];
}

/** Conservative small talk: never includes a question or an action request. */
export function isSmallTalk(text: string): boolean {
  const input = text.trim();
  if (!input || input.length > 80 || /[?]/.test(input)) return false;

  return (
    /^(?:hi|hello|hey|yo|namaste|namaskar|hola)[!. ]*$/i.test(input) ||
    /^(?:thanks|thank you|ok|okay|cool|great|nice|perfect|sounds good|haan|theek hai|shukriya|dhanyavad)[!. ]*$/i.test(
      input
    )
  );
}

/** Deterministic reply for small talk; returns null when the text is not small talk. */
export function smallTalkReply(text: string): string | null {
  const input = text.trim();
  if (!isSmallTalk(input)) return null;

  if (/^(?:thanks|thank you|shukriya|dhanyavad)\b/i.test(input)) {
    return 'Koi baat nahi. Koi aur kaam ho to batao.';
  }
  if (/^(?:haan|theek hai|ok|okay|cool|great|nice|perfect|sounds good)\b/i.test(input)) {
    return '👍 Batao, ab kya karein?';
  }
  return 'Namaste! Main Orbit hoon. Batao, aaj kya karna hai?';
}
