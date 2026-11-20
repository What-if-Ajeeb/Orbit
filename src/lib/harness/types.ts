import type { AiSettings } from '../ai/settings';
import type { McpServerSyncStatus } from '../mcp/registry';
import type { McpServerConfig } from '../mcp/settings';

export type HarnessPluginKind = 'provider' | 'tool' | 'storage' | 'mcp';

export type HarnessPluginState =
  | 'active'
  | 'ready'
  | 'configured'
  | 'disabled'
  | 'error';

/**
 * One row in the harness view. Every capability in Orbit — a wire protocol, a
 * task tool, a chat store, or an MCP server — is described with the same shape.
 */
export type HarnessPlugin = {
  id: string;
  kind: HarnessPluginKind;
  name: string;
  summary: string;
  state: HarnessPluginState;
  detail?: string;
};

export type HarnessCounts = {
  providers: number;
  tools: number;
  storages: number;
  mcpServers: number;
  mcpTools: number;
};

export type HarnessSnapshot = {
  plugins: HarnessPlugin[];
  counts: HarnessCounts;
  aiReady: boolean;
  activeProvider: string;
  activeAdapter: string;
  activeChatStore: string;
  checkedAt: number;
};

export type HarnessBuildInput = {
  ai: AiSettings;
  mcpServers: McpServerConfig[];
  mcpStatuses: McpServerSyncStatus[];
  mcpToolCount: number;
  now?: number;
};
