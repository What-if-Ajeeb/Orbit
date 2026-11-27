import type { AiSettings } from '../ai/settings';
import type {
  HermesPromptTier,
  ProviderKind,
} from '../hermes/types';
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

/** Read-only disclosure of Hermes contracts; nothing here is executable. */
export type HermesContractSnapshot = {
  provider: {
    kind: ProviderKind;
    provider: AiSettings['provider'];
    adapterId: string | null;
    configured: boolean;
    fallback: boolean;
    routeCount: number;
  };
  toolsets: {
    ids: string[];
    registeredCount: number;
    availableCount: number;
  };
  skills: {
    visibleIds: string[];
    bundleIds: string[];
  };
  prompt: {
    tiers: HermesPromptTier[];
    maxChars: number;
  };
  memory: {
    agentChars: number;
    userChars: number;
  };
  sessionSearch: {
    queryChars: number;
    terms: number;
    snippetChars: number;
    promptChars: number;
    rows: number;
  };
  /** Hash of the descriptors above; identical configuration yields this value. */
  fingerprint: string;
  checkedAt: number;
};

export type HarnessSnapshot = {
  plugins: HarnessPlugin[];
  counts: HarnessCounts;
  aiReady: boolean;
  activeProvider: string;
  activeAdapter: string;
  activeChatStore: string;
  hermes: HermesContractSnapshot;
  checkedAt: number;
};

export type HarnessBuildInput = {
  ai: AiSettings;
  mcpServers: McpServerConfig[];
  mcpStatuses: McpServerSyncStatus[];
  mcpToolCount: number;
  now?: number;
};
