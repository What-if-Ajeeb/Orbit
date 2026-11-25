import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { aiProviderRegistry } from './provider-registry';
import {
  createSseParser,
  geminiAdapter,
  ollamaAdapter,
  openAiAdapter,
  parseSsePayloads,
  requestCompletion,
} from './providers';
import type { AiSettings } from './settings';
import type { LlmMessage, LlmToolDefinition } from './types';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));
vi.mock('./ollama', () => ({
  ON_DEVICE_OLLAMA_BASE_URL: 'http://127.0.0.1:11434',
  ollamaChat: vi.fn(async () => ({ text: '', toolCalls: [] })),
  OllamaRequestError: class OllamaRequestError extends Error {
    code: string;

    constructor(message: string, code = 'unknown') {
      super(message);
      this.code = code;
    }
  },
}));

beforeAll(() => {
  for (const adapter of [openAiAdapter, geminiAdapter, ollamaAdapter]) {
    aiProviderRegistry.register(adapter, { replace: true });
  }
});

const OPENAI_SETTINGS: AiSettings = {
  provider: 'openai',
  mode: 'cloud',
  baseUrl: 'https://api.example.com/v1',
  model: 'gpt-test',
  apiKey: 'sk-test',
};

const GEMINI_SETTINGS: AiSettings = {
  provider: 'gemini',
  mode: 'cloud',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-test',
  apiKey: 'test-key',
};

const messages: LlmMessage[] = [{ role: 'user', content: 'Hello' }];
const tools: LlmToolDefinition[] = [];

/** Minimal Response that exposes a chunked ReadableStream reader. */
function sseResponse(events: string[], splitAt = 1): Response {
  const raw = events.map((event) => `data: ${event}\n\n`).join('');
  const chunks = [raw.slice(0, splitAt), raw.slice(splitAt)];
  let index = 0;

  const reader = {
    read: async () => {
      if (index < chunks.length) {
        const value = new TextEncoder().encode(chunks[index]);
        index += 1;
        return { done: false, value };
      }

      return { done: true, value: undefined };
    },
  };

  return {
    ok: true,
    status: 200,
    body: { getReader: () => reader },
  } as unknown as Response;
}

describe('SSE parsing', () => {
  it('extracts multi-line data payloads and ignores comments', () => {
    const raw = ': keep-alive\n\ndata: {"a":1}\ndata: {"b":2}\n\ndata: [DONE]\n\n';
    expect(parseSsePayloads(raw)).toEqual(['{"a":1}\n{"b":2}', '[DONE]']);
  });

  it('reassembles payloads split across arbitrary chunks', () => {
    const raw = 'data: {"delta":"Hi"}\n\ndata: [DONE]\n\n';
    const seen: string[] = [];
    const parser = createSseParser((payload) => seen.push(payload));

    for (let index = 0; index < raw.length; index += 3) {
      parser.push(raw.slice(index, index + 3));
    }
    parser.flush();

    expect(seen).toEqual(['{"delta":"Hi"}', '[DONE]']);
  });
});

describe('provider streaming', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([])));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('streams OpenAI text and assembles fragmented tool calls', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        '{"choices":[{"delta":{"content":"Checking "}}]}',
        '{"choices":[{"delta":{"content":"weather"}}]}',
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"get_weather","arguments":""}}]}}]}',
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]}}]}',
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"Pune\\"}"}}]}}]}',
        '[DONE]',
      ])
    );

    const deltas: string[] = [];
    const turn = await requestCompletion(OPENAI_SETTINGS, messages, tools, {
      onTextDelta: (delta) => deltas.push(delta),
    });

    expect(turn.text).toBe('Checking weather');
    expect(turn.toolCalls).toEqual([
      { id: 'call_1', name: 'get_weather', arguments: '{"city":"Pune"}' },
    ]);
    expect(deltas).toEqual(['Checking ', 'weather']);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body)).stream).toBe(true);
    expect(String(init.headers) !== 'undefined').toBe(true);
  });

  it('streams Gemini chunks and function calls', async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      sseResponse([
        '{"candidates":[{"content":{"parts":[{"text":"Sure"}]}}]}',
        '{"candidates":[{"content":{"parts":[{"functionCall":{"name":"list_tasks","args":{}}}]}}]}',
      ])
    );

    const deltas: string[] = [];
    const turn = await requestCompletion(GEMINI_SETTINGS, messages, tools, {
      onTextDelta: (delta) => deltas.push(delta),
    });

    expect(turn.text).toBe('Sure');
    expect(turn.toolCalls).toHaveLength(1);
    expect(turn.toolCalls[0].name).toBe('list_tasks');
    expect(deltas).toEqual(['Sure']);

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(':streamGenerateContent?alt=sse');
  });

  it('honours an already-aborted signal without issuing a request', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      requestCompletion(OPENAI_SETTINGS, messages, tools, {
        onTextDelta: () => undefined,
        signal: controller.signal,
      })
    ).rejects.toThrow('AI request cancelled.');
  });
});
