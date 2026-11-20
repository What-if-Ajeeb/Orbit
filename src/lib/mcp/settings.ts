import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type McpServerConfig = {
  id: string;
  name: string;
  url: string;
  /** Optional bearer token. Stored with the config in SecureStore. */
  token: string;
  enabled: boolean;
};

export type McpServerInput = {
  id?: string;
  name: string;
  url: string;
  token: string;
  enabled?: boolean;
};

const MCP_KEY = 'orbit.mcp.servers.v1';

let cachedServers: McpServerConfig[] | null = null;

type WebStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function getWebStorage(): WebStorage | null {
  return (globalThis as { localStorage?: WebStorage }).localStorage ?? null;
}

export function newMcpServerId(): string {
  return `mcp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function withProtocol(url: string): string {
  if (!url) {
    return '';
  }

  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}

function normalizeServer(value: Partial<McpServerConfig>): McpServerConfig | null {
  const url = withProtocol((value.url ?? '').trim());

  if (!url) {
    return null;
  }

  const name = (value.name ?? '').trim() || url.replace(/^https?:\/\//i, '').split('/')[0];

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id : newMcpServerId(),
    name: name.slice(0, 60),
    url,
    token: (value.token ?? '').trim(),
    enabled: value.enabled !== false,
  };
}

function normalizeList(value: unknown): McpServerConfig[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const servers: McpServerConfig[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const server = normalizeServer(item as Partial<McpServerConfig>);

    if (server && !seen.has(server.id)) {
      seen.add(server.id);
      servers.push(server);
    }
  }

  return servers;
}

export function clearMcpServersCache(): void {
  cachedServers = null;
}

export async function loadMcpServers(): Promise<McpServerConfig[]> {
  if (cachedServers) {
    return cachedServers.map((server) => ({ ...server }));
  }

  try {
    const raw =
      Platform.OS === 'web'
        ? getWebStorage()?.getItem(MCP_KEY) ?? null
        : await SecureStore.getItemAsync(MCP_KEY);

    cachedServers = raw ? normalizeList(JSON.parse(raw)) : [];
  } catch (error) {
    console.warn('Could not load MCP servers.', error);
    cachedServers = [];
  }

  return cachedServers.map((server) => ({ ...server }));
}

export async function saveMcpServers(servers: McpServerConfig[]): Promise<McpServerConfig[]> {
  const normalized = normalizeList(servers);
  const raw = JSON.stringify(normalized);

  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(MCP_KEY, raw);
  } else {
    await SecureStore.setItemAsync(MCP_KEY, raw);
  }

  cachedServers = normalized;
  return normalized.map((server) => ({ ...server }));
}

export function buildMcpServer(input: McpServerInput): McpServerConfig {
  const fallbackId = newMcpServerId();

  return (
    normalizeServer({
      id: input.id ?? fallbackId,
      name: input.name,
      url: input.url,
      token: input.token,
      enabled: input.enabled ?? true,
    }) ?? {
      id: input.id ?? fallbackId,
      name: input.name.trim() || 'MCP server',
      url: withProtocol(input.url.trim()),
      token: input.token.trim(),
      enabled: input.enabled ?? true,
    }
  );
}
