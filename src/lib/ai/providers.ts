import { buildAttachmentText, safeImageAttachments } from './attachment-content';
import { ollamaChat } from './ollama';
import {
  aiProviderRegistry,
  type AiProviderAdapter,
  type CompletionOptions,
} from './provider-registry';
import { isAiConfigured, PROVIDER_PRESETS, type AiSettings } from './settings';
import type { LlmMessage, LlmToolDefinition, LlmToolCall, LlmTurn } from './types';

const REQUEST_TIMEOUT_MS = 45_000;

export class AiError extends Error {
  status: number | null;

  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = 'AiError';
    this.status = status;
  }
}

type JsonRecord = Record<string, unknown>;

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

function friendlyError(status: number, rawMessage: string): string {
  const detail = rawMessage.trim().slice(0, 240);

  if (status === 400) {
    return detail ? `The provider rejected the request: ${detail}` : 'The provider rejected the request.';
  }

  if (status === 401 || status === 403) {
    return 'API key is invalid or missing. Check Settings → AI.';
  }

  if (status === 404) {
    return 'Model or endpoint not found. Check the model name and base URL in Settings → AI.';
  }

  if (status === 429) {
    return 'Rate limit reached. Wait a moment and try again.';
  }

  if (status >= 500) {
    return 'The AI provider is having trouble right now. Try again shortly.';
  }

  return detail || `The AI request failed (HTTP ${status}).`;
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  externalSignal?: AbortSignal
): Promise<JsonRecord> {
  const controller = new AbortController();
  let timedOut = false;
  let cancelled = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  const onAbort = () => {
    cancelled = true;
    controller.abort();
  };

  if (externalSignal?.aborted) {
    cancelled = true;
    controller.abort();
  } else {
    externalSignal?.addEventListener('abort', onAbort, { once: true });
  }

  let response: Response;

  try {
    response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (cancelled) {
      throw new AiError('AI request cancelled.');
    }

    if (timedOut || (error instanceof Error && error.name === 'AbortError')) {
      throw new AiError('The request timed out. Check your connection and try again.');
    }

    throw new AiError('Could not reach the AI provider. Check your internet connection.');
  } finally {
    clearTimeout(timeout);
    externalSignal?.removeEventListener('abort', onAbort);
  }

  const raw = await response.text();
  let data: JsonRecord | null = null;

  try {
    data = raw ? (JSON.parse(raw) as JsonRecord) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const errorObject = asRecord(data?.error);
    const message =
      asString(errorObject?.message) || asString(data?.message) || raw || `HTTP ${response.status}`;
    throw new AiError(friendlyError(response.status, message), response.status);
  }

  if (!data) {
    throw new AiError('The AI provider returned an empty response.');
  }

  return data;
}

function toOpenAiMessages(messages: LlmMessage[]): JsonRecord[] {
  return messages.map((message) => {
    if (message.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: message.toolCallId,
        content: message.content,
      };
    }

    if (message.role === 'assistant') {
      const result: JsonRecord = {
        role: 'assistant',
        content: message.content || null,
      };

      if (message.toolCalls.length > 0) {
        result.tool_calls = message.toolCalls.map((call) => ({
          id: call.id,
          type: 'function',
          function: { name: call.name, arguments: call.arguments },
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
    const baseText = documentText && text !== documentText ? `${text}\n\n${documentText}` : text;

    if (images.length === 0) {
      return { role: 'user', content: baseText };
    }

    return {
      role: 'user',
      content: [
        { type: 'text', text: baseText },
        ...images.map((image) => ({
          type: 'image_url',
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        })),
      ],
    };
  });
}

async function openAiCompletion(
  settings: AiSettings,
  messages: LlmMessage[],
  tools: LlmToolDefinition[],
  options: CompletionOptions = {}
): Promise<LlmTurn> {
  const body: JsonRecord = {
    model: settings.model,
    messages: toOpenAiMessages(messages),
  };

  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
    body.tool_choice = 'auto';
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const apiKey = settings.apiKey.trim();

  // Never leak a saved cloud key to a local endpoint.
  if (apiKey && settings.mode !== 'local') {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const data = await postJson(
    buildUrl(settings.baseUrl, '/chat/completions'),
    headers,
    body,
    options.signal
  );

  const choices = Array.isArray(data.choices) ? data.choices : [];
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);

  if (!message) {
    throw new AiError('The provider returned an unexpected response.');
  }

  const rawToolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
  const toolCalls: LlmToolCall[] = [];

  rawToolCalls.forEach((value, index) => {
    const call = asRecord(value);
    const fn = asRecord(call?.function);

    if (!fn || !asString(fn.name)) {
      return;
    }

    toolCalls.push({
      id: asString(call?.id) || `call_${index}`,
      name: asString(fn.name),
      arguments: asString(fn.arguments) || '{}',
    });
  });

  return {
    text: asString(message.content).trim(),
    toolCalls,
  };
}

function toGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(toGeminiSchema);
  }

  const record = asRecord(value);

  if (!record) {
    return value;
  }

  const result: JsonRecord = {};

  for (const [key, entry] of Object.entries(record)) {
    if (key === 'additionalProperties' || key === '$schema') {
      continue;
    }

    if (key === 'type' && typeof entry === 'string') {
      result.type = entry.toUpperCase();
      continue;
    }

    if (key === 'properties') {
      const properties = asRecord(entry);
      result.properties = properties
        ? Object.fromEntries(
            Object.entries(properties).map(([name, schema]) => [name, toGeminiSchema(schema)])
          )
        : entry;
      continue;
    }

    result[key] = toGeminiSchema(entry);
  }

  return result;
}

type GeminiPart = {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name?: string; args?: unknown };
  functionResponse?: { name?: string; response?: unknown };
};

function parseToolArguments(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function toGeminiContents(
  messages: LlmMessage[]
): { role: 'user' | 'model'; parts: GeminiPart[] }[] {
  // Function responses must be user turns, placed after the model turn that
  // requested them.
  const withTools: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];

  for (const message of messages) {
    if (message.role === 'system') {
      continue;
    }

    if (message.role === 'tool') {
      const last = withTools[withTools.length - 1];
      const part: GeminiPart = {
        functionResponse: {
          name: message.name,
          response: { result: message.content },
        },
      };

      if (last && last.role === 'user') {
        last.parts.push(part);
      } else {
        withTools.push({ role: 'user', parts: [part] });
      }

      continue;
    }

    if (message.role === 'assistant') {
      const parts: GeminiPart[] = [];

      if (message.content) {
        parts.push({ text: message.content });
      }

      for (const call of message.toolCalls) {
        parts.push({
          functionCall: { name: call.name, args: parseToolArguments(call.arguments) },
        });
      }

      withTools.push({ role: 'model', parts });
      continue;
    }

    const attachments = message.attachments ?? [];
    const images = safeImageAttachments(attachments);
    const documentText = buildAttachmentText(attachments.filter((item) => item.kind === 'document'));
    const text = message.content.trim() ? message.content : documentText || '(see attachment)';
    const baseText = documentText && text !== documentText ? `${text}\n\n${documentText}` : text;
    const parts: GeminiPart[] = [{ text: baseText }];

    for (const image of images) {
      parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
    }

    withTools.push({ role: 'user', parts });
  }

  // Merge adjacent turns with the same role, as Gemini expects an
  // alternating conversation.
  const merged: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];

  for (const content of withTools) {
    if (content.parts.length === 0) {
      continue;
    }

    const last = merged[merged.length - 1];

    if (last && last.role === content.role) {
      last.parts.push(...content.parts);
    } else {
      merged.push({ role: content.role, parts: [...content.parts] });
    }
  }

  return merged;
}

async function geminiCompletion(
  settings: AiSettings,
  messages: LlmMessage[],
  tools: LlmToolDefinition[],
  options: CompletionOptions = {}
): Promise<LlmTurn> {
  const systemText = messages
    .filter((message): message is Extract<LlmMessage, { role: 'system' }> => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');

  const body: JsonRecord = {
    contents: toGeminiContents(messages),
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 2048,
    },
  };

  if (systemText) {
    body.systemInstruction = { parts: [{ text: systemText }] };
  }

  if (tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: toGeminiSchema(tool.parameters),
        })),
      },
    ];
    body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
  }

  const url = `${buildUrl(settings.baseUrl, '')}/models/${encodeURIComponent(
    settings.model
  )}:generateContent`;

  const data = await postJson(
    url,
    {
      'Content-Type': 'application/json',
      'x-goog-api-key': settings.apiKey,
    },
    body,
    options.signal
  );

  const promptFeedback = asRecord(data.promptFeedback);

  if (asString(promptFeedback?.blockReason)) {
    throw new AiError('The AI provider blocked this request. Try rephrasing it.');
  }

  const candidates = Array.isArray(data.candidates) ? data.candidates : [];
  const candidate = asRecord(candidates[0]);
  const content = asRecord(candidate?.content);
  const rawParts = Array.isArray(content?.parts) ? content.parts : [];

  const textParts: string[] = [];
  const toolCalls: LlmToolCall[] = [];

  rawParts.forEach((value, index) => {
    const part = asRecord(value);

    if (!part) {
      return;
    }

    if (typeof part.text === 'string') {
      textParts.push(part.text);
    }

    const functionCall = asRecord(part.functionCall);
    const name = asString(functionCall?.name);

    if (functionCall && name) {
      toolCalls.push({
        id: `gemini_${Date.now()}_${index}`,
        name,
        arguments: JSON.stringify(functionCall.args ?? {}),
      });
    }
  });

  if (!candidate) {
    throw new AiError('The provider returned an unexpected response.');
  }

  return {
    text: textParts.join('').trim(),
    toolCalls,
  };
}

export const openAiAdapter: AiProviderAdapter = {
  id: 'openai-compatible',
  label: 'OpenAI-compatible',
  complete: ({ settings, messages, tools }, options = {}) =>
    openAiCompletion(settings, messages, tools, options),
};

export const geminiAdapter: AiProviderAdapter = {
  id: 'gemini',
  label: 'Google Gemini',
  complete: ({ settings, messages, tools }, options = {}) =>
    geminiCompletion(settings, messages, tools, options),
};

/** Native Ollama `/api/chat` adapter (no OpenAI-compatible `/v1` proxy). */
export const ollamaAdapter: AiProviderAdapter = {
  id: 'ollama-native',
  label: 'Ollama (native)',
  complete: ({ settings, messages, tools }, options = {}) =>
    ollamaChat(settings, messages, tools, {
      onTextDelta: options.onTextDelta,
      signal: options.signal,
    }),
};

export async function requestCompletion(
  settings: AiSettings,
  messages: LlmMessage[],
  tools: LlmToolDefinition[],
  options: CompletionOptions = {}
): Promise<LlmTurn> {
  if (!isAiConfigured(settings)) {
    throw new AiError('AI is not configured yet. Check your provider details in Settings → AI.');
  }

  const adapterId = PROVIDER_PRESETS[settings.provider]?.adapterId ?? 'openai-compatible';
  const adapter = aiProviderRegistry.get(adapterId);

  if (!adapter) {
    throw new AiError(`No AI adapter is registered for “${settings.provider}”.`);
  }

  return adapter.complete({ settings, messages, tools }, options);
}

export async function pingAi(settings: AiSettings): Promise<string> {
  const turn = await requestCompletion(
    settings,
    [{ role: 'user', content: 'Reply with the single word: OK' }],
    []
  );

  return turn.text || 'OK';
}
