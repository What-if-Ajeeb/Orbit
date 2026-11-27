import { aiProviderRegistry } from '../ai/provider-registry';
import {
  isAiConfigured,
  loadAiSettings,
  PROVIDER_ORDER,
  PROVIDER_PRESETS,
} from '../ai/settings';
import { agentToolRegistry } from '../ai/tool-registry';
// Importing the built-in modules registers their plugins exactly once:
// provider adapters from providers.ts and task tools from tools.ts.
import '../ai/providers';
import '../ai/tools';
import {
  getActiveChatStoreId,
  listChatStorePlugins,
} from '../chat';
import {
  getMcpStatuses,
  getMcpToolCount,
} from '../mcp/registry';
import { loadMcpServers } from '../mcp/settings';
import { buildHermesContractSection } from './hermes';
import type {
  HarnessBuildInput,
  HarnessPlugin,
  HarnessSnapshot,
} from './types';

export type {
  HarnessBuildInput,
  HarnessCounts,
  HermesContractSnapshot,
  HarnessPlugin,
  HarnessPluginKind,
  HarnessPluginState,
  HarnessSnapshot,
} from './types';

export { aiProviderRegistry } from '../ai/provider-registry';
export { agentToolRegistry } from '../ai/tool-registry';
export {
  getActiveChatStoreId,
  listChatStorePlugins,
  registerChatStorePlugin,
  setActiveChatStore,
} from '../chat';
export type { ChatStorePlugin } from '../chat';
export { getMcpStatuses, getMcpToolCount, refreshMcpTools, syncMcpTools } from '../mcp/registry';

function firstLine(text: string, max = 150): string {
  const clean = text.replace(/\s+/g, ' ').trim();

  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/**
 * Builds the harness view from the live registries. Pure apart from reading the
 * registries, so the screen, tests, or a future CLI can share the same snapshot.
 */
export function buildHarnessSnapshot(input: HarnessBuildInput): HarnessSnapshot {
  const { ai, mcpServers, mcpStatuses, mcpToolCount, now = Date.now() } = input;
  const activeAdapter = PROVIDER_PRESETS[ai.provider]?.adapterId ?? 'openai-compatible';
  const aiReady = isAiConfigured(ai);
  const plugins: HarnessPlugin[] = [];

  for (const adapter of aiProviderRegistry.list()) {
    const presets = PROVIDER_ORDER.filter(
      (provider) => PROVIDER_PRESETS[provider].adapterId === adapter.id
    ).map((provider) => PROVIDER_PRESETS[provider].shortLabel);
    const active = adapter.id === activeAdapter;

    plugins.push({
      id: `provider:${adapter.id}`,
      kind: 'provider',
      name: adapter.label,
      summary: presets.length > 0 ? `Presets: ${presets.join(' · ')}` : 'Wire-protocol adapter',
      state: active ? (aiReady ? 'active' : 'configured') : 'ready',
      detail: active
        ? aiReady
          ? `${PROVIDER_PRESETS[ai.provider].label} · ${ai.model}`
          : 'Add an API key in Settings'
        : undefined,
    });
  }

  for (const tool of agentToolRegistry.definitions()) {
    if (tool.name.startsWith('mcp__')) {
      continue;
    }

    plugins.push({
      id: `tool:${tool.name}`,
      kind: 'tool',
      name: tool.name,
      summary: firstLine(tool.description),
      state: 'ready',
    });
  }

  for (const store of listChatStorePlugins()) {
    plugins.push({
      id: `storage:${store.id}`,
      kind: 'storage',
      name: store.label,
      summary: store.description,
      state: store.id === getActiveChatStoreId() ? 'active' : 'ready',
    });
  }

  const statusById = new Map(
    mcpStatuses.map((status) => [status.serverId, status])
  );

  for (const server of mcpServers) {
    const status = statusById.get(server.id);
    const state: HarnessPlugin['state'] = !server.enabled
      ? 'disabled'
      : status
        ? status.ok
          ? 'active'
          : 'error'
        : 'configured';

    plugins.push({
      id: `mcp:${server.id}`,
      kind: 'mcp',
      name: server.name,
      summary: server.url,
      state,
      detail: !server.enabled
        ? 'Disabled in Settings'
        : status
          ? status.ok
            ? `${status.toolCount} tool${status.toolCount === 1 ? '' : 's'}`
            : status.error ?? 'Connection failed'
          : 'Not synced yet',
    });
  }

  return {
    plugins,
    counts: {
      providers: aiProviderRegistry.list().length,
      tools: plugins.filter((plugin) => plugin.kind === 'tool').length,
      storages: plugins.filter((plugin) => plugin.kind === 'storage').length,
      mcpServers: mcpServers.length,
      mcpTools: mcpToolCount,
    },
    aiReady,
    activeProvider: PROVIDER_PRESETS[ai.provider]?.label ?? ai.provider,
    activeAdapter,
    activeChatStore: getActiveChatStoreId(),
    hermes: buildHermesContractSection(ai, now),
    checkedAt: now,
  };
}

/** Loads secure settings and combines them with the live registries. */
export async function loadHarnessSnapshot(): Promise<HarnessSnapshot> {
  const [ai, mcpServers] = await Promise.all([
    loadAiSettings(),
    loadMcpServers(),
  ]);

  return buildHarnessSnapshot({
    ai,
    mcpServers,
    mcpStatuses: getMcpStatuses(),
    mcpToolCount: getMcpToolCount(),
  });
}
