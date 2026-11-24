import { agentToolRegistry, type AgentTool } from '../ai/tool-registry';
import type { LlmToolDefinition } from '../ai/types';
import { mcpPluginId } from '../plugins/mcp-bridge';
import { McpClient, type McpTool } from './client';
import { loadMcpServers, type McpServerConfig } from './settings';

export type McpToolGate = (serverId: string) => {
  allowed: boolean;
  pluginId: string;
  reason?: string;
};

export type McpServerSyncStatus = {
  serverId: string;
  serverName: string;
  ok: boolean;
  toolCount: number;
  error?: string;
};

export type McpSyncResult = {
  statuses: McpServerSyncStatus[];
  toolCount: number;
  syncedAt: number;
};

const SYNC_TTL_MS = 5 * 60_000;
const CLIENT_TTL_MS = 30 * 60_000;

type ClientCacheEntry = {
  fingerprint: string;
  client: McpClient;
  usedAt: number;
};

let statuses: McpServerSyncStatus[] = [];
let registeredTools = new Set<string>();
let lastSyncAt = 0;
let syncedOnce = false;
let syncInFlight: Promise<McpSyncResult> | null = null;

const clientCache = new Map<string, ClientCacheEntry>();
const TOOL_PREFIX = 'mcp__';
const MAX_TOOL_NAME = 64;

let toolGate: McpToolGate | null = null;

/**
 * Installs the plugin-platform gate for MCP tool execution. When no gate is
 * installed (headless tests, early boot) tools behave as before.
 */
export function setMcpToolGate(gate: McpToolGate | null): void {
  toolGate = gate;
}

export function getMcpToolGate(): McpToolGate | null {
  return toolGate;
}

function slug(value: string): string {
  const clean = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);

  return clean || 'server';
}

function sanitizeToolName(value: string): string {
  const clean = value
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);

  return clean || 'tool';
}

function toolNameFor(server: McpServerConfig, tool: McpTool, used: Set<string>): string {
  const base = `${TOOL_PREFIX}${slug(server.name || server.url)}__${sanitizeToolName(tool.name)}`.slice(
    0,
    MAX_TOOL_NAME
  );

  let candidate = base;
  let counter = 2;

  while (used.has(candidate)) {
    const suffix = `_${counter}`;
    candidate = `${base.slice(0, MAX_TOOL_NAME - suffix.length)}${suffix}`;
    counter += 1;
  }

  used.add(candidate);
  return candidate;
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'MCP server failed.';
}

function unregisterMcpTools(): void {
  for (const name of registeredTools) {
    agentToolRegistry.unregister(name);
  }

  registeredTools = new Set();
}

/**
 * Returns a client for the server, reusing an open session when the URL and
 * token have not changed. Cached clients are dropped after 30 minutes.
 */
function getClient(server: McpServerConfig): McpClient {
  const fingerprint = `${server.url}\n${server.token}`;
  const cached = clientCache.get(server.id);

  if (cached && cached.fingerprint === fingerprint) {
    cached.usedAt = Date.now();
    return cached.client;
  }

  const client = new McpClient(server);
  clientCache.set(server.id, { fingerprint, client, usedAt: Date.now() });
  return client;
}

function pruneClients(activeServerIds: Set<string>): void {
  const now = Date.now();

  for (const [serverId, entry] of clientCache) {
    if (!activeServerIds.has(serverId) || now - entry.usedAt > CLIENT_TTL_MS) {
      clientCache.delete(serverId);
    }
  }
}

function buildAgentTool(
  server: McpServerConfig,
  tool: McpTool,
  exposedName: string
): AgentTool {
  const definition: LlmToolDefinition = {
    name: exposedName,
    description: truncate(
      `${tool.description || tool.title || tool.name} — via MCP server “${server.name}”.`,
      900
    ),
    parameters: tool.inputSchema,
  };
  const pluginId = mcpPluginId(server.id);

  return {
    meta: {
      source: 'mcp',
      pluginId,
      trustLevel: 'local',
      permissions: ['mcp.connect', 'ai.invoke'],
    },
    definition,
    async execute(_context, args) {
      const label = tool.title || tool.name;
      const gate = toolGate?.(server.id);

      if (gate && !gate.allowed) {
        return {
          content: `MCP tool blocked: ${gate.reason ?? 'the MCP integration is not enabled.'}`,
          trace: `MCP · ${server.name}: ${label} blocked`,
        };
      }

      try {
        const result = await getClient(server).callTool(tool.name, args);

        if (result.isError) {
          return {
            content: `MCP error from ${server.name}: ${result.text}`,
            trace: `MCP · ${server.name}: ${label} failed`,
          };
        }

        return {
          content: `MCP result from ${server.name}:\n${result.text}`,
          trace: `MCP · ${server.name}: ${label}`,
        };
      } catch (error) {
        return {
          content: `MCP tool failed: ${messageOf(error)}`,
          trace: `MCP · ${server.name}: ${label} failed`,
        };
      }
    },
  };
}

async function runSync(servers: McpServerConfig[]): Promise<McpSyncResult> {
  unregisterMcpTools();

  const enabled = servers.filter((server) => server.enabled && server.url.trim());
  const activeIds = new Set(enabled.map((server) => server.id));
  pruneClients(activeIds);

  if (enabled.length === 0) {
    statuses = [];
    lastSyncAt = Date.now();
    syncedOnce = true;

    return { statuses, toolCount: 0, syncedAt: lastSyncAt };
  }

  const fetched = await Promise.all(
    enabled.map(async (server) => {
      try {
        const tools = await getClient(server).listTools();
        return { server, tools, error: null as string | null };
      } catch (error) {
        clientCache.delete(server.id);
        return { server, tools: [] as McpTool[], error: messageOf(error) };
      }
    })
  );

  const nextStatuses: McpServerSyncStatus[] = [];
  const usedNames = new Set<string>();

  for (const entry of fetched) {
    if (entry.error) {
      nextStatuses.push({
        serverId: entry.server.id,
        serverName: entry.server.name,
        ok: false,
        toolCount: 0,
        error: entry.error,
      });
      continue;
    }

    for (const tool of entry.tools) {
      const exposedName = toolNameFor(entry.server, tool, usedNames);

      try {
        agentToolRegistry.register(buildAgentTool(entry.server, tool, exposedName));
        registeredTools.add(exposedName);
      } catch (error) {
        console.warn(`Could not register MCP tool ${exposedName}.`, error);
      }
    }

    nextStatuses.push({
      serverId: entry.server.id,
      serverName: entry.server.name,
      ok: true,
      toolCount: entry.tools.length,
    });
  }

  statuses = nextStatuses;
  lastSyncAt = Date.now();
  syncedOnce = true;

  return { statuses, toolCount: registeredTools.size, syncedAt: lastSyncAt };
}

/**
 * Connects to enabled MCP servers and mirrors their tools into the agent tool
 * registry. Results are cached for five minutes; failures are reported per
 * server instead of breaking the chat.
 */
export async function syncMcpTools(
  options: { force?: boolean; servers?: McpServerConfig[] } = {}
): Promise<McpSyncResult> {
  if (syncInFlight) {
    if (!options.force) {
      return syncInFlight;
    }

    try {
      await syncInFlight;
    } catch {
      // A forced sync below retries with the latest configuration.
    }
  }

  if (!options.force && syncedOnce && Date.now() - lastSyncAt < SYNC_TTL_MS) {
    return {
      statuses: statuses.map((status) => ({ ...status })),
      toolCount: registeredTools.size,
      syncedAt: lastSyncAt,
    };
  }

  const servers = options.servers ?? (await loadMcpServers());

  const promise = runSync(servers).finally(() => {
    syncInFlight = null;
  });

  syncInFlight = promise;
  return promise;
}

/** Called before every agent run; cheap when no servers are configured. */
export async function ensureMcpTools(): Promise<void> {
  try {
    const servers = await loadMcpServers();

    if (!servers.some((server) => server.enabled && server.url.trim())) {
      if (registeredTools.size > 0 || statuses.length > 0) {
        unregisterMcpTools();
        statuses = [];
      }

      lastSyncAt = Date.now();
      syncedOnce = true;
      return;
    }

    await syncMcpTools({ servers });
  } catch (error) {
    console.warn('Could not sync MCP tools.', error);
  }
}

export async function refreshMcpTools(
  servers?: McpServerConfig[]
): Promise<McpSyncResult> {
  return syncMcpTools({ force: true, servers });
}

export function getMcpStatuses(): McpServerSyncStatus[] {
  return statuses.map((status) => ({ ...status }));
}

export function getMcpToolCount(): number {
  return registeredTools.size;
}

/** Exposed for tests and for a future "disconnect" action. */
export function resetMcpRuntime(): void {
  unregisterMcpTools();
  clientCache.clear();
  statuses = [];
  lastSyncAt = 0;
  syncedOnce = false;
  syncInFlight = null;
}
