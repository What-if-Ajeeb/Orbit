import { fetch as expoFetch } from 'expo/fetch';

import type { JsonSchema } from '../ai/types';
import type { McpServerConfig } from './settings';

const CLIENT_NAME = 'Orbit';
const CLIENT_VERSION = '1.6.0';

/** Latest per-request-metadata revision (no initialize handshake). */
const MODERN_PROTOCOL_VERSION = '2026-07-28';
/** Last widely deployed initialization-based revision. */
const LEGACY_PROTOCOL_VERSION = '2025-06-18';

const CONNECT_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 20_000;
const CALL_TIMEOUT_MS = 60_000;
const MAX_RESULT_CHARS = 24_000;

type JsonRecord = Record<string, unknown>;

type FetchResponseLike = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
  body: ReadableStream<Uint8Array> | null;
};

type FetchInitLike = {
  method: string;
  headers: Record<string, string>;
  body: string;
  signal?: AbortSignal;
};

export type FetchLike = (url: string, init: FetchInitLike) => Promise<FetchResponseLike>;

type McpClientOptions = {
  fetchImpl?: FetchLike;
};

export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchema;
};

export type McpCallResult = {
  text: string;
  isError: boolean;
};

export class McpError extends Error {
  code: number | null;
  httpStatus: number | null;
  supportedVersions: string[];

  constructor(
    message: string,
    options: {
      code?: number | null;
      httpStatus?: number | null;
      supportedVersions?: string[];
    } = {}
  ) {
    super(message);
    this.name = 'McpError';
    this.code = options.code ?? null;
    this.httpStatus = options.httpStatus ?? null;
    this.supportedVersions = options.supportedVersions ?? [];
  }
}

let defaultFetch: FetchLike = expoFetch as unknown as FetchLike;

/** Lets tests (and future transports) swap the HTTP implementation. */
export function setMcpFetchImplementation(fetchImpl: FetchLike | null): void {
  defaultFetch = fetchImpl ?? (expoFetch as unknown as FetchLike);
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'MCP request failed.';
}

function rpcErrorFrom(error: JsonRecord, httpStatus: number | null): McpError {
  const data = asRecord(error.data);
  const supported = Array.isArray(data?.supported)
    ? data.supported.filter((item): item is string => typeof item === 'string')
    : [];

  return new McpError(asString(error.message) || 'MCP request failed.', {
    code: typeof error.code === 'number' ? error.code : null,
    httpStatus,
    supportedVersions: supported,
  });
}

function errorFromResponse(status: number, statusText: string, body: string): McpError {
  const parsed = asRecord(safeParse(body));
  const rpcError = asRecord(parsed?.error);

  if (rpcError) {
    return rpcErrorFrom(rpcError, status);
  }

  const detail = body.trim().slice(0, 160);
  const suffix = detail ? ` — ${detail}` : '';

  return new McpError(
    `MCP server returned HTTP ${status}${statusText ? ` ${statusText}` : ''}${suffix}`,
    { httpStatus: status }
  );
}

function normalizeInputSchema(value: unknown): JsonSchema {
  const schema = asRecord(value);
  const properties = asRecord(schema?.properties) ?? {};
  const required = Array.isArray(schema?.required)
    ? schema.required.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    type: 'object',
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...(typeof schema?.additionalProperties === 'boolean'
      ? { additionalProperties: schema.additionalProperties }
      : {}),
  };
}

function normalizeTool(value: unknown): McpTool | null {
  const tool = asRecord(value);
  const name = asString(tool?.name).trim();

  if (!name) {
    return null;
  }

  return {
    name,
    title: asString(tool?.title).trim() || undefined,
    description: asString(tool?.description).trim() || undefined,
    inputSchema: normalizeInputSchema(tool?.inputSchema),
  };
}

function contentToText(result: JsonRecord): string {
  const chunks: string[] = [];
  const content = Array.isArray(result.content) ? result.content : [];

  for (const item of content) {
    const part = asRecord(item);

    if (!part) {
      continue;
    }

    const type = asString(part.type);

    if (type === 'text') {
      const text = asString(part.text);

      if (text) {
        chunks.push(text);
      }
    } else if (type === 'resource') {
      const resource = asRecord(part.resource);
      const text = asString(resource?.text);
      const uri = asString(resource?.uri);

      if (text) {
        chunks.push(text);
      } else if (uri) {
        chunks.push(`[resource ${uri}]`);
      }
    } else if (type === 'resource_link') {
      const name = asString(part.name) || 'resource';
      const uri = asString(part.uri);
      chunks.push(`[${name}${uri ? `: ${uri}` : ''}]`);
    } else if (type === 'image') {
      chunks.push(`[image ${asString(part.mimeType) || 'binary'}]`);
    } else if (type === 'audio') {
      chunks.push(`[audio ${asString(part.mimeType) || 'binary'}]`);
    } else {
      chunks.push(JSON.stringify(part));
    }
  }

  if (chunks.length === 0) {
    const structured = result.structuredContent;

    if (structured !== undefined) {
      return typeof structured === 'string' ? structured : JSON.stringify(structured, null, 2);
    }
  }

  return chunks.join('\n\n');
}

function truncate(text: string): string {
  if (text.length <= MAX_RESULT_CHARS) {
    return text;
  }

  return `${text.slice(0, MAX_RESULT_CHARS)}\n\n…[result truncated at ${MAX_RESULT_CHARS} characters]`;
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = index + 1 < bytes.length ? bytes[index + 1] : null;
    const third = index + 2 < bytes.length ? bytes[index + 2] : null;

    output += BASE64_ALPHABET[first >> 2];
    output += BASE64_ALPHABET[((first & 0x03) << 4) | ((second ?? 0) >> 4)];
    output +=
      second === null
        ? '='
        : BASE64_ALPHABET[((second & 0x0f) << 2) | ((third ?? 0) >> 6)];
    output += third === null ? '=' : BASE64_ALPHABET[third & 0x3f];
  }

  return output;
}

function headerValue(value: string): string {
  const isSafe = /^[\x21-\x7e](?:[\x20-\x7e\t]*[\x21-\x7e])?$/.test(value);
  const looksEncoded = value.startsWith('=?base64?') && value.endsWith('?=');

  return isSafe && !looksEncoded ? value : `=?base64?${base64Utf8(value)}?=`;
}

/**
 * Minimal Streamable HTTP MCP client.
 *
 * Tries the legacy `initialize` handshake first because most deployed servers
 * still speak 2025-06-18 / 2025-11-25. If that fails, it probes
 * `server/discover` and switches to the 2026-07-28 per-request metadata era.
 * Sessions are optional; a server may reject them and remain fully usable.
 */
export class McpClient {
  private readonly server: McpServerConfig;
  private readonly fetchImpl: FetchLike;

  private era: 'unknown' | 'legacy' | 'modern' = 'unknown';
  private protocolVersion = '';
  private sessionId: string | null = null;
  private nextRequestId = 1;
  private serverName = '';

  constructor(server: McpServerConfig, options: McpClientOptions = {}) {
    this.server = server;
    this.fetchImpl = options.fetchImpl ?? defaultFetch;
  }

  get name(): string {
    return this.serverName || this.server.name;
  }

  reset(): void {
    this.era = 'unknown';
    this.protocolVersion = '';
    this.sessionId = null;
    this.nextRequestId = 1;
    this.serverName = '';
  }

  async connect(): Promise<void> {
    if (this.era !== 'unknown') {
      return;
    }

    if (!this.server.url.trim()) {
      throw new McpError('MCP server URL is empty.');
    }

    try {
      const result = await this.request(
        'initialize',
        {
          protocolVersion: LEGACY_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
        },
        CONNECT_TIMEOUT_MS
      );

      this.era = 'legacy';
      this.protocolVersion = asString(result.protocolVersion) || LEGACY_PROTOCOL_VERSION;
      this.serverName = asString(asRecord(result.serverInfo)?.name) || this.server.name;

      try {
        await this.notify('notifications/initialized');
      } catch {
        // Some stateless legacy servers do not implement the notification.
      }

      return;
    } catch (legacyError) {
      if (
        legacyError instanceof McpError &&
        (legacyError.httpStatus === 401 || legacyError.httpStatus === 403)
      ) {
        throw legacyError;
      }

      // Probe the modern (2026-07-28) era with a stateless request.
      this.era = 'modern';
      this.protocolVersion = MODERN_PROTOCOL_VERSION;

      try {
        const discover = await this.request('server/discover', {}, CONNECT_TIMEOUT_MS);
        this.serverName =
          asString(asRecord(asRecord(discover._meta)?.['io.modelcontextprotocol/serverInfo'])?.name) ||
          this.serverName ||
          this.server.name;
        return;
      } catch (modernError) {
        this.reset();

        if (
          modernError instanceof McpError &&
          (modernError.httpStatus === 401 || modernError.httpStatus === 403)
        ) {
          throw modernError;
        }

        throw legacyError instanceof McpError
          ? legacyError
          : new McpError(messageOf(legacyError));
      }
    }
  }

  async listTools(): Promise<McpTool[]> {
    await this.connect();

    const tools: McpTool[] = [];
    let cursor = '';

    for (let page = 0; page < 10; page += 1) {
      const result = await this.request(
        'tools/list',
        cursor ? { cursor } : {},
        LIST_TIMEOUT_MS
      );

      const list = Array.isArray(result.tools) ? result.tools : [];

      for (const item of list) {
        const tool = normalizeTool(item);

        if (tool) {
          tools.push(tool);
        }
      }

      cursor = asString(result.nextCursor);
      if (!cursor) {
        break;
      }
    }

    return tools;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    try {
      return await this.callToolOnce(name, args);
    } catch (error) {
      const sessionExpired =
        this.era === 'legacy' &&
        error instanceof McpError &&
        (error.httpStatus === 404 || error.code === -32600);

      if (!sessionExpired) {
        throw error;
      }

      this.reset();
      return this.callToolOnce(name, args);
    }
  }

  async close(): Promise<void> {
    const sessionId = this.sessionId;
    this.sessionId = null;

    if (!sessionId) {
      return;
    }

    try {
      await this.fetchImpl(this.server.url, {
        method: 'DELETE',
        headers: {
          ...(this.server.token ? { Authorization: `Bearer ${this.server.token}` } : {}),
          'Mcp-Session-Id': sessionId,
        },
        body: '',
      });
    } catch {
      // Best-effort cleanup.
    }
  }

  private async callToolOnce(
    name: string,
    args: Record<string, unknown>
  ): Promise<McpCallResult> {
    await this.connect();

    const result = await this.request(
      'tools/call',
      { name, arguments: args },
      CALL_TIMEOUT_MS
    );

    return {
      text: truncate(contentToText(result) || 'The MCP tool returned no content.'),
      isError: result.isError === true,
    };
  }

  private async notify(method: string, params?: JsonRecord): Promise<void> {
    await this.post(
      {
        jsonrpc: '2.0',
        method,
        ...(params ? { params } : {}),
      },
      5_000,
      null
    );
  }

  private withMetadata(params: JsonRecord): JsonRecord {
    if (this.era !== 'modern') {
      return params;
    }

    return {
      ...params,
      _meta: {
        'io.modelcontextprotocol/protocolVersion': this.protocolVersion,
        'io.modelcontextprotocol/clientInfo': {
          name: CLIENT_NAME,
          version: CLIENT_VERSION,
        },
        'io.modelcontextprotocol/clientCapabilities': {},
      },
    };
  }

  private async request(
    method: string,
    params: JsonRecord,
    timeoutMs: number
  ): Promise<JsonRecord> {
    const id = this.nextRequestId;
    this.nextRequestId += 1;

    const result = await this.post(
      {
        jsonrpc: '2.0',
        id,
        method,
        params: this.withMetadata(params),
      },
      timeoutMs,
      id
    );

    return asRecord(result) ?? {};
  }

  private async post(
    payload: JsonRecord,
    timeoutMs: number,
    expectedId: number | null
  ): Promise<unknown> {
    const method = asString(payload.method);
    const params = asRecord(payload.params) ?? {};
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };

    if (this.server.token) {
      headers.Authorization = `Bearer ${this.server.token}`;
    }

    if (this.sessionId) {
      headers['Mcp-Session-Id'] = this.sessionId;
    }

    if (this.era === 'modern') {
      headers['MCP-Protocol-Version'] = this.protocolVersion;
      headers['Mcp-Method'] = method;
    } else if (this.protocolVersion && method !== 'initialize') {
      headers['MCP-Protocol-Version'] = this.protocolVersion;
    }

    if (this.era === 'modern' && method === 'tools/call') {
      const name = asString(params.name);

      if (name) {
        headers['Mcp-Name'] = headerValue(name);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      let response: FetchResponseLike;

      try {
        response = await this.fetchImpl(this.server.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw new McpError(`MCP request timed out after ${timeoutMs / 1000}s.`);
        }

        throw new McpError(`Could not reach the MCP server: ${messageOf(error)}`);
      }

      const sessionId = response.headers.get('mcp-session-id');

      if (sessionId) {
        this.sessionId = sessionId;
      }

      if (response.status === 202 || expectedId === null) {
        return null;
      }

      if (!response.ok) {
        throw errorFromResponse(response.status, response.statusText, await response.text());
      }

      const contentType = response.headers.get('content-type') ?? '';

      if (contentType.toLowerCase().includes('text/event-stream')) {
        return await this.readSse(response, expectedId);
      }

      const body = await response.text();
      const parsed = asRecord(safeParse(body));

      if (!parsed) {
        throw new McpError('MCP server returned a non-JSON response.');
      }

      const rpcError = asRecord(parsed.error);

      if (rpcError) {
        throw rpcErrorFrom(rpcError, response.status);
      }

      if (!('result' in parsed)) {
        throw new McpError('MCP server returned an unexpected response.');
      }

      return parsed.result;
    } finally {
      clearTimeout(timer);
    }
  }

  private async readSse(
    response: FetchResponseLike,
    expectedId: number
  ): Promise<unknown> {
    const state: { result: unknown; error: McpError | null } = {
      result: null,
      error: null,
    };
    let dataLines: string[] = [];
    let buffer = '';

    const consumeLine = (line: string) => {
      const clean = line.endsWith('\r') ? line.slice(0, -1) : line;

      if (clean === '') {
        if (dataLines.length === 0) {
          return;
        }

        const payload = dataLines.join('\n');
        dataLines = [];

        const parsed = asRecord(safeParse(payload));
        if (!parsed || parsed.id !== expectedId) {
          return;
        }

        const error = asRecord(parsed.error);
        if (error) {
          state.error = rpcErrorFrom(error, response.status);
        } else if ('result' in parsed) {
          state.result = parsed.result;
        }
      } else if (clean.startsWith('data:')) {
        dataLines.push(clean.slice(5).replace(/^ /, ''));
      }
    };

    const body = response.body;

    if (body) {
      const reader = body.getReader();
      const decoder = new TextDecoder();

      try {
        while (state.error === null && state.result === null) {
          const chunk = await reader.read();

          if (chunk.done) {
            break;
          }

          buffer += decoder.decode(chunk.value, { stream: true });

          let newline = buffer.indexOf('\n');
          while (newline >= 0) {
            consumeLine(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf('\n');
          }
        }

        buffer += decoder.decode();
      } finally {
        try {
          await reader.cancel();
        } catch {
          // The stream may already be closed.
        }
      }
    } else {
      buffer = await response.text();
    }

    if (buffer) {
      consumeLine(buffer);
    }

    if (dataLines.length > 0) {
      consumeLine('');
    }

    if (state.error) {
      throw state.error;
    }

    if (state.result === null) {
      throw new McpError('MCP server closed the stream without a response.');
    }

    return state.result;
  }
}
