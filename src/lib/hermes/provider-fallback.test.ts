import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BudgetExceededError } from '../agent-runtime/budgets';
import type { AiSettings } from '../ai/settings';
import type { LlmMessage } from '../ai/types';

import { AiError } from '../ai/providers';
import {
  classifyProviderError,
  requestCompletionWithSystemFallback,
} from './provider-fallback';

const mocks = vi.hoisted(() => ({ requestCompletion: vi.fn() }));

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-provider-test' }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

vi.mock('../ai/providers', () => {
  class AiError extends Error {
    status: number | null;

    constructor(message: string, status: number | null = null) {
      super(message);
      this.name = 'AiError';
      this.status = status;
    }
  }

  return { AiError, requestCompletion: mocks.requestCompletion };
});

const settings = (overrides: Partial<AiSettings> = {}): AiSettings => ({
  provider: 'ollama',
  mode: 'local',
  baseUrl: 'http://127.0.0.1:11434',
  model: 'local-model',
  apiKey: '',
  webSearch: true,
  ...overrides,
});

const messages: LlmMessage[] = [
  { role: 'system', content: 'system prompt with secret marker' },
  { role: 'user', content: 'Please summarise the private notes' },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Hermes route-level provider fallback', () => {
  it('calls the configured provider once and passes a successful turn through', async () => {
    const deltas: string[] = [];
    mocks.requestCompletion.mockImplementation(async (_settings, _messages, _tools, options) => {
      options.onTextDelta('partial');
      return { text: 'Done.', toolCalls: [] };
    });

    const result = await requestCompletionWithSystemFallback({
      settings: settings(),
      messages,
      tools: [],
      options: { onTextDelta: (delta) => deltas.push(delta) },
      snapshotId: 'snap-1',
    });

    expect(mocks.requestCompletion).toHaveBeenCalledOnce();
    expect(result.turn).toEqual({ text: 'Done.', toolCalls: [] });
    expect(result.usedFallback).toBe(false);
    expect(deltas).toEqual(['partial']);
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        route: 'primary',
        kind: 'ollama',
        outcome: 'succeeded',
        snapshotId: 'snap-1',
      }),
    ]);
  });

  it('falls back deterministically on provider failure without a second call', async () => {
    mocks.requestCompletion.mockRejectedValue(new AiError('API key is invalid or missing.', 401));

    const result = await requestCompletionWithSystemFallback({
      settings: settings(),
      messages,
      tools: [],
    });

    expect(mocks.requestCompletion).toHaveBeenCalledOnce();
    expect(result.usedFallback).toBe(true);
    expect(result.turn.toolCalls).toEqual([]);
    expect(result.turn.text).toContain('On-device AI is unavailable right now');
    expect(result.diagnostics.map((entry) => entry.outcome)).toEqual(['failed', 'fallback']);
    expect(result.diagnostics[0]).toMatchObject({ errorKind: 'auth', status: 401 });
  });

  it('never falls back for cancellation or a stopped signal', async () => {
    mocks.requestCompletion.mockRejectedValue(new AiError('AI request cancelled.'));
    await expect(
      requestCompletionWithSystemFallback({ settings: settings(), messages, tools: [] })
    ).rejects.toThrow(/cancelled/);

    mocks.requestCompletion.mockRejectedValue(new Error('unknown transport closed'));
    const controller = new AbortController();
    controller.abort();
    await expect(
      requestCompletionWithSystemFallback({
        settings: settings(),
        messages,
        tools: [],
        options: { signal: controller.signal },
      })
    ).rejects.toThrow(/unknown transport/);

    mocks.requestCompletion.mockRejectedValue(new BudgetExceededError('Token budget exceeded.'));
    await expect(
      requestCompletionWithSystemFallback({ settings: settings(), messages, tools: [] })
    ).rejects.toThrow(BudgetExceededError);
  });

  it('discards buffered deltas when the provider fails', async () => {
    const deltas: string[] = [];
    mocks.requestCompletion.mockImplementation(async (_settings, _messages, _tools, options) => {
      options.onTextDelta('partial');
      throw new AiError('The request timed out.');
    });

    const result = await requestCompletionWithSystemFallback({
      settings: settings(),
      messages,
      tools: [],
      options: { onTextDelta: (delta) => deltas.push(delta) },
    });

    expect(deltas).toEqual([]);
    expect(result.usedFallback).toBe(true);
    expect(classifyProviderError(new AiError('The request timed out.'))).toBe('timeout');
  });

  it('never persists keys, URLs or prompt text in diagnostics', async () => {
    mocks.requestCompletion.mockRejectedValue(new AiError('bad request', 400));
    const secretSettings = settings({
      mode: 'cloud',
      provider: 'openai',
      baseUrl: 'https://user:password@example.com/v1?token=abc123',
      apiKey: 'sk-supersecretkey',
      model: 'secret-model',
    });

    const result = await requestCompletionWithSystemFallback({
      settings: secretSettings,
      messages,
      tools: [],
    });
    const serialised = JSON.stringify(result.diagnostics);

    expect(serialised).not.toContain('supersecretkey');
    expect(serialised).not.toContain('password');
    expect(serialised).not.toContain('token=abc123');
    expect(serialised).not.toContain('private notes');
    expect(serialised).not.toContain('secret-model');
  });

  it('skips the network entirely when no provider is configured', async () => {
    const result = await requestCompletionWithSystemFallback({
      settings: settings({ baseUrl: '', model: '' }),
      messages,
      tools: [],
    });

    expect(mocks.requestCompletion).not.toHaveBeenCalled();
    expect(result.diagnostics[0]).toMatchObject({ route: 'system', outcome: 'skipped' });
  });
});
