import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  listOllamaModels,
  normalizeOllamaBaseUrl,
  ollamaChat,
  ON_DEVICE_OLLAMA_BASE_URL,
} from './ollama';

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: vi.fn(async () => JSON.stringify(data)),
    body: null,
  };
}

function errorResponse(status: number, body: unknown) {
  return jsonResponse(body, status);
}

function streamResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  let index = 0;

  return {
    ok: true,
    status: 200,
    text: vi.fn(async () => ''),
    body: {
      getReader: () => ({
        read: async () => {
          if (index >= chunks.length) {
            return { done: true, value: undefined };
          }

          const value = chunks[index];
          index += 1;
          return { done: false, value: encoder.encode(value) };
        },
        releaseLock: () => undefined,
      }),
    },
  };
}

function callsOf(fetchMock: ReturnType<typeof vi.fn>): FetchCall[] {
  return fetchMock.mock.calls.map(([url, init]) => ({ url, init }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('native Ollama client', () => {
  it('uses the native base URL and strips a legacy /v1 suffix', () => {
    expect(ON_DEVICE_OLLAMA_BASE_URL).toBe('http://127.0.0.1:11434');
    expect(normalizeOllamaBaseUrl(' http://127.0.0.1:11434/v1/ ')).toBe(
      'http://127.0.0.1:11434'
    );
  });

  it('discovers installed models from GET /api/tags', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        models: [
          {
            name: 'qwen2.5:0.5b',
            size: 397_000_000,
            details: { parameter_size: '0.5B', quantization_level: 'Q4_K_M' },
          },
          { name: 'llama3.2' },
          { name: 'llama3.2' },
        ],
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const models = await listOllamaModels('http://127.0.0.1:11434/v1');

    expect(callsOf(fetchMock)[0].url).toBe('http://127.0.0.1:11434/api/tags');
    expect(callsOf(fetchMock)[0].init?.method).toBe('GET');
    expect(models).toEqual([
      {
        name: 'qwen2.5:0.5b',
        size: 397_000_000,
        parameterSize: '0.5B',
        quantizationLevel: 'Q4_K_M',
      },
      {
        name: 'llama3.2',
        size: undefined,
        parameterSize: undefined,
        quantizationLevel: undefined,
      },
    ]);
  });

  it('posts stream:false for a normal chat completion', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ message: { role: 'assistant', content: 'Hello from Ollama.' } })
    );
    vi.stubGlobal('fetch', fetchMock);

    const turn = await ollamaChat(
      { baseUrl: ON_DEVICE_OLLAMA_BASE_URL, model: 'qwen2.5:0.5b' },
      [{ role: 'user', content: 'Hi' }],
      []
    );

    const call = callsOf(fetchMock)[0];
    expect(call.url).toBe('http://127.0.0.1:11434/api/chat');
    expect(JSON.parse(String(call.init?.body))).toMatchObject({
      model: 'qwen2.5:0.5b',
      stream: false,
      messages: [{ role: 'user', content: 'Hi' }],
    });
    expect(turn).toEqual({ text: 'Hello from Ollama.', toolCalls: [] });
  });

  it('streams NDJSON deltas across chunk boundaries', async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse([
        '{"message":{"content":"Hello"}}\n{"message":{"cont',
        'ent":" there"}}\n{"message":{"content":"!"},"done":true}\n',
      ])
    );
    vi.stubGlobal('fetch', fetchMock);
    const deltas: string[] = [];

    const turn = await ollamaChat(
      { baseUrl: ON_DEVICE_OLLAMA_BASE_URL, model: 'qwen2.5:0.5b' },
      [{ role: 'user', content: 'Hi' }],
      [],
      { onTextDelta: (delta) => deltas.push(delta) }
    );

    expect(JSON.parse(String(callsOf(fetchMock)[0].init?.body)).stream).toBe(true);
    expect(deltas).toEqual(['Hello', ' there', '!']);
    expect(turn.text).toBe('Hello there!');
  });

  it('retries transient network failures', async () => {
    const success = jsonResponse({ models: [{ name: 'qwen2.5:0.5b' }] });
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce(success);
    vi.stubGlobal('fetch', fetchMock);

    const models = await listOllamaModels(ON_DEVICE_OLLAMA_BASE_URL, { retryDelayMs: 0 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(models[0].name).toBe('qwen2.5:0.5b');
  });

  it('maps an aborted request to a timeout or cancellation', async () => {
    const fetchMock = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise((_resolve, reject) => {
          if (init?.signal?.aborted) {
            reject(new Error('aborted'));
            return;
          }

          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      listOllamaModels(ON_DEVICE_OLLAMA_BASE_URL, {
        timeoutMs: 15,
        retries: 0,
      })
    ).rejects.toMatchObject({ code: 'timeout' });

    const controller = new AbortController();
    controller.abort();

    await expect(
      listOllamaModels(ON_DEVICE_OLLAMA_BASE_URL, {
        retries: 0,
        signal: controller.signal,
      })
    ).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('explains a missing model in HTTP errors', async () => {
    const fetchMock = vi.fn(async () =>
      errorResponse(404, { error: 'model "missing-model" not found, try pulling it first' })
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      ollamaChat(
        { baseUrl: ON_DEVICE_OLLAMA_BASE_URL, model: 'missing-model' },
        [{ role: 'user', content: 'Hi' }],
        [],
        { retries: 0 }
      )
    ).rejects.toMatchObject({
      code: 'http',
      status: 404,
      message: expect.stringContaining('not installed in Ollama'),
    });
  });
});
