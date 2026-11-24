import { buildAttachmentText, safeImageAttachments } from './attachment-content';
import type { LlmMessage, LlmToolCall, LlmToolDefinition, LlmTurn } from './types';

/** Native Ollama HTTP API base URL — no `/v1` suffix. */
export const ON_DEVICE_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

export const OLLAMA_DISCOVERY_TIMEOUT_MS = 8_000;
export const OLLAMA_CHAT_TIMEOUT_MS = 60_000;

const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_DELAY_MS = 300;

type JsonRecord = Record<string, unknown>;

export type OllamaErrorCode =
  | 'network'
  | 'timeout'
  | 'cancelled'
  | 'http'
  | 'invalid_response';

export class OllamaRequestError extends Error {
  code: OllamaErrorCode;
  status: number | null;
  retryable: boolean;

  constructor(
    message: string,
    code: OllamaErrorCode,
    status: number | null = null,
    retryable = false
  ) {
    super(message);
    this.name = 'OllamaRequestError';
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export type OllamaRequestOptions = {
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  signal?: AbortSignal;
};

export type OllamaChatOptions = OllamaRequestOptions & {
  /** Defaults to true when `onTextDelta` is supplied, otherwise false. */
  stream?: boolean;
  onTextDelta?: (delta: string) => void;
};

export type OllamaModel = {
  name: string;
  size?: number;
  parameterSize?: string;
  quantizationLevel?: string;
};

type OpenedResponse = {
  response: Response;
  cleanup: () => void;
  getFailure: () => OllamaRequestError | null;
};

type RequestGuard = {
  controller: AbortController;
  cleanup: () => void;
  getFailure: () => OllamaRequestError | null;
};

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function buildUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

function parseJsonRecord(raw: string): JsonRecord {
  try {
    const value = JSON.parse(raw) as unknown;
    const record = asRecord(value);

    if (record) {
      return record;
    }
  } catch {
    // Fall through to the friendly error below.
  }

  throw new OllamaRequestError(
    'Ollama returned a response Orbit could not read. Check that the native API is enabled.',
    'invalid_response'
  );
}

function detailFrom(raw: string): string {
  if (!raw.trim()) {
    return '';
  }

  const parsed = parseJsonRecordSafe(raw);
  const detail =
    asString(parsed?.error) || asString(parsed?.message) || asString(parsed?.detail) || raw;

  return detail.trim().slice(0, 240);
}

function parseJsonRecordSafe(raw: string): JsonRecord | null {
  try {
    return asRecord(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function httpError(status: number, raw: string, url: string, model: string): OllamaRequestError {
  const detail = detailFrom(raw);

  const modelMissing = model && /model|not found/i.test(detail);

  if ((status === 400 || status === 404 || status === 422) && modelMissing) {
    return new OllamaRequestError(
      `Model “${model}” is not installed in Ollama. Refresh models in Settings → AI and choose one that is listed.`,
      'http',
      status
    );
  }

  if (status === 404) {
    return new OllamaRequestError(
      `Ollama endpoint not found at ${url}. Use the native API base URL (for example ${ON_DEVICE_OLLAMA_BASE_URL}) without /v1.`,
      'http',
      status
    );
  }

  if (status === 408 || status === 429 || status >= 500) {
    return new OllamaRequestError(
      detail || 'Ollama is busy. Try again in a moment.',
      'http',
      status,
      true
    );
  }

  return new OllamaRequestError(
    detail || `Ollama request failed (HTTP ${status}).`,
    'http',
    status
  );
}

function networkError(url: string): OllamaRequestError {
  return new OllamaRequestError(
    `Could not reach Ollama at ${url}. Keep the Ollama app running on this device and use ${ON_DEVICE_OLLAMA_BASE_URL}. Plain HTTP is allowed only for 127.0.0.1 in this Android build.`,
    'network',
    null,
    true
  );
}

function createRequestGuard(timeoutMs: number, signal?: AbortSignal): RequestGuard {
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));

  const onAbort = () => {
    cancelled = true;
    controller.abort();
  };

  if (signal?.aborted) {
    cancelled = true;
    controller.abort();
  } else {
    signal?.addEventListener('abort', onAbort, { once: true });
  }

  return {
    controller,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
    getFailure: () => {
      if (cancelled) {
        return new OllamaRequestError('Ollama request cancelled.', 'cancelled');
      }

      if (timedOut) {
        return new OllamaRequestError(
          `Ollama did not respond within ${Math.round(timeoutMs / 1000)} seconds. Check that the server is running and try again.`,
          'timeout'
        );
      }

      return null;
    },
  };
}

function mapCaughtError(
  error: unknown,
  guardFailure: () => OllamaRequestError | null,
  url: string
): OllamaRequestError {
  const failure = guardFailure();

  if (failure) {
    return failure;
  }

  if (error instanceof OllamaRequestError) {
    return error;
  }

  return networkError(url);
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new OllamaRequestError('Ollama request cancelled.', 'cancelled'));
      return;
    }

    const onAbort = () => {
      clearTimeout(timer);
      reject(new OllamaRequestError('Ollama request cancelled.', 'cancelled'));
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

async function openOllamaRequest(
  url: string,
  method: 'GET' | 'POST',
  body: unknown,
  options: OllamaRequestOptions
): Promise<OpenedResponse> {
  const retries = Math.max(0, options.retries ?? DEFAULT_RETRIES);
  const timeoutMs = options.timeoutMs ?? OLLAMA_DISCOVERY_TIMEOUT_MS;
  const model = asString(asRecord(body)?.model);
  let lastError: OllamaRequestError | null = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const guard = createRequestGuard(timeoutMs, options.signal);

    try {
      const response = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: guard.controller.signal,
      });

      if (!response.ok) {
        const raw = await response.text().catch(() => '');
        throw httpError(response.status, raw, url, model);
      }

      return {
        response,
        cleanup: guard.cleanup,
        getFailure: guard.getFailure,
      };
    } catch (error) {
      guard.cleanup();
      const mapped = mapCaughtError(error, guard.getFailure, url);
      lastError = mapped;

      if (!mapped.retryable || attempt === retries) {
        throw mapped;
      }

      await wait(options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS, options.signal);
    }
  }

  throw lastError ?? networkError(url);
}

async function readJsonLines(
  response: Response,
  onRecord: (record: JsonRecord) => void
): Promise<void> {
  const body = response.body as ReadableStream<Uint8Array> | null;

  if (!body || typeof body.getReader !== 'function') {
    const raw = await response.text();

    for (const line of raw.split(/\r?\n/)) {
      if (line.trim()) {
        onRecord(parseJsonRecord(line));
      }
    }

    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const consume = (line: string) => {
    if (line.trim()) {
      onRecord(parseJsonRecord(line));
    }
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    consume(buffer);
  } finally {
    reader.releaseLock();
  }
}

function parseToolArguments(raw: unknown): unknown {
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return {};
    }
  }

  return raw ?? {};
}

function toolCallsFromMessage(message: JsonRecord | null): {
  id?: string;
  name: string;
  arguments: unknown;
}[] {
  const rawCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
  const calls: { id?: string; name: string; arguments: unknown }[] = [];

  rawCalls.forEach((value, index) => {
    const call = asRecord(value);
    const fn = asRecord(call?.function);
    const name = asString(fn?.name);

    if (!name) {
      return;
    }

    calls.push({
      id: asString(call?.id) || undefined,
      name,
      arguments: parseToolArguments(fn?.arguments),
    });
  });

  return calls;
}

function stringifyToolArguments(value: unknown): string {
  if (typeof value === 'string') {
    return value || '{}';
  }

  if (value === undefined || value === null) {
    return '{}';
  }

  try {
    return JSON.stringify(value);
  } catch {
    return '{}';
  }
}

type AccumulatedToolCall = {
  id?: string;
  name: string;
  arguments: unknown;
};

function mergeArguments(existing: unknown, incoming: unknown): unknown {
  if (typeof existing === 'string' && typeof incoming === 'string') {
    return existing + incoming;
  }

  const existingRecord = asRecord(existing);
  const incomingRecord = asRecord(incoming);

  if (existingRecord && incomingRecord) {
    const result: JsonRecord = { ...existingRecord };

    for (const [key, value] of Object.entries(incomingRecord)) {
      result[key] = key in result ? mergeArguments(result[key], value) : value;
    }

    return result;
  }

  return incoming === undefined ? existing : incoming;
}

function toLlmToolCalls(calls: AccumulatedToolCall[]): LlmToolCall[] {
  return calls.map((call, index) => ({
    id: call.id || `ollama_call_${index}`,
    name: call.name,
    arguments: stringifyToolArguments(call.arguments),
  }));
}

function toOllamaMessages(messages: LlmMessage[]): JsonRecord[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return { role: 'tool', content: message.content, tool_name: message.name };
    }

    if (message.role === 'assistant') {
      const result: JsonRecord = {
        role: 'assistant',
        content: message.content,
      };

      if (message.toolCalls.length > 0) {
        result.tool_calls = message.toolCalls.map((call) => ({
          function: {
            name: call.name,
            arguments: parseToolArguments(call.arguments),
          },
        }));
      }

      return result;
    }

    if (message.role === 'system') {
      return { role: 'system', content: message.content };
    }

    const attachments = message.attachments ?? [];
    const images = safeImageAttachments(attachments);
    const documentText = buildAttachmentText(attachments.filter((item) => item.kind === 'document'));
    const text = message.content.trim() ? message.content : documentText || '(see attachment)';
    const result: JsonRecord = {
      role: 'user',
      content: documentText && text !== documentText ? `${text}\n\n${documentText}` : text,
    };

    if (images.length > 0) {
      result.images = images.map((image) => image.data);
    }

    return result;
  });
}

function toOllamaTools(tools: LlmToolDefinition[]): JsonRecord[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function parseChatResponse(record: JsonRecord): LlmTurn {
  const message = asRecord(record.message);

  if (!message) {
    throw new OllamaRequestError(
      'Ollama returned an unexpected chat response.',
      'invalid_response'
    );
  }

  return {
    text: asString(message.content).trim(),
    toolCalls: toLlmToolCalls(toolCallsFromMessage(message)),
  };
}

/** Strip the old OpenAI-compatible `/v1` suffix from an Ollama base URL. */
export function normalizeOllamaBaseUrl(value: string): string {
  return value
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v1$/i, '');
}

/** GET /api/tags — discover the models actually installed on the server. */
export async function listOllamaModels(
  baseUrl: string,
  options: OllamaRequestOptions = {}
): Promise<OllamaModel[]> {
  const normalized = normalizeOllamaBaseUrl(baseUrl) || ON_DEVICE_OLLAMA_BASE_URL;
  const url = buildUrl(normalized, '/api/tags');
  const opened = await openOllamaRequest(url, 'GET', undefined, options);

  try {
    const raw = await opened.response.text();
    const data = parseJsonRecord(raw);
    const rawModels = Array.isArray(data.models) ? data.models : [];
    const seen = new Set<string>();
    const models: OllamaModel[] = [];

    for (const value of rawModels) {
      const model = asRecord(value);
      const name = asString(model?.name).trim() || asString(model?.model).trim();

      if (!name || seen.has(name)) {
        continue;
      }

      seen.add(name);
      const details = asRecord(model?.details);
      models.push({
        name,
        size: typeof model?.size === 'number' ? model.size : undefined,
        parameterSize: asString(details?.parameter_size) || undefined,
        quantizationLevel: asString(details?.quantization_level) || undefined,
      });
    }

    return models;
  } catch (error) {
    throw mapCaughtError(error, opened.getFailure, url);
  } finally {
    opened.cleanup();
  }
}

/** POST /api/chat — stream:true when a text delta callback is supplied. */
export async function ollamaChat(
  settings: { baseUrl: string; model: string },
  messages: LlmMessage[],
  tools: LlmToolDefinition[],
  options: OllamaChatOptions = {}
): Promise<LlmTurn> {
  const model = settings.model.trim();

  if (!model) {
    throw new OllamaRequestError(
      'No Ollama model is selected. Open Settings → AI and choose an installed model.',
      'invalid_response'
    );
  }

  const stream = options.stream ?? typeof options.onTextDelta === 'function';
  const url = buildUrl(normalizeOllamaBaseUrl(settings.baseUrl), '/api/chat');
  const body: JsonRecord = {
    model,
    messages: toOllamaMessages(messages),
    stream,
  };

  if (tools.length > 0) {
    body.tools = toOllamaTools(tools);
  }

  const opened = await openOllamaRequest(url, 'POST', body, {
    timeoutMs: options.timeoutMs ?? OLLAMA_CHAT_TIMEOUT_MS,
    retries: options.retries,
    retryDelayMs: options.retryDelayMs,
    signal: options.signal,
  });

  try {
    if (!stream) {
      const raw = await opened.response.text();
      return parseChatResponse(parseJsonRecord(raw));
    }

    let text = '';
    const accumulated = new Map<string, AccumulatedToolCall>();

    await readJsonLines(opened.response, (record) => {
      const errorMessage = asString(record.error);

      if (errorMessage) {
        throw new OllamaRequestError(
          detailFrom(errorMessage) || 'Ollama could not complete the chat.',
          'http',
          null
        );
      }

      const message = asRecord(record.message);
      const content = asString(message?.content);

      if (content) {
        text += content;
        options.onTextDelta?.(content);
      }

      const calls = toolCallsFromMessage(message);
      calls.forEach((call, index) => {
        const key = call.id || `${index}`;
        const existing = accumulated.get(key);

        accumulated.set(key, {
          id: call.id ?? existing?.id,
          name: call.name || existing?.name || '',
          arguments: existing ? mergeArguments(existing.arguments, call.arguments) : call.arguments,
        });
      });
    });

    return {
      text: text.trim(),
      toolCalls: toLlmToolCalls(Array.from(accumulated.values()).filter((call) => call.name)),
    };
  } catch (error) {
    throw mapCaughtError(error, opened.getFailure, url);
  } finally {
    opened.cleanup();
  }
}
