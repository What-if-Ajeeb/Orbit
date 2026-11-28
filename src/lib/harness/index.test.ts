import { describe, expect, it, vi } from 'vitest';

import type { AiSettings } from '../ai/settings';

import { buildHarnessSnapshot } from './index';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-harness-test' }));
vi.mock('expo-constants', () => ({ default: { expoConfig: {} } }));
vi.mock('expo-file-system', () => ({
  readAsStringAsync: vi.fn(async () => ''),
  writeAsStringAsync: vi.fn(async () => undefined),
  deleteAsync: vi.fn(async () => undefined),
  documentDirectory: 'file:///',
}));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));
vi.mock('../ai/providers', () => ({}));
vi.mock('../ai/tools', async () => {
  const { agentToolRegistry } = await vi.importActual<
    typeof import('../ai/tool-registry')
  >('../ai/tool-registry');
  for (const name of ['memory_remember', 'sandbox_read_file', 'web_search']) {
    agentToolRegistry.register(
      {
        definition: {
          name,
          description: `Test tool ${name}.`,
          parameters: { type: 'object', properties: {}, additionalProperties: false },
        },
        execute: async () => ({ content: '', trace: '' }),
      },
      { replace: true }
    );
  }
  return { listAgentTools: () => agentToolRegistry.definitions() };
});
vi.mock('../chat', () => ({
  getActiveChatStoreId: () => 'sqlite',
  listChatStorePlugins: () => [],
}));
vi.mock('../mcp/registry', () => ({
  getMcpStatuses: () => [],
  getMcpToolCount: () => 0,
}));
vi.mock('../mcp/settings', () => ({ loadMcpServers: vi.fn(async () => []) }));

const settings = (overrides: Partial<AiSettings> = {}): AiSettings => ({
  provider: 'ollama',
  mode: 'local',
  baseUrl: 'http://user:pass@127.0.0.1:11434',
  model: 'local-model',
  apiKey: 'sk-supersecret',
  webSearch: true,
  ...overrides,
});

const build = (ai: AiSettings) =>
  buildHarnessSnapshot({
    ai,
    mcpServers: [],
    mcpStatuses: [],
    mcpToolCount: 0,
    now: 1_700_000_000_000,
  });

describe('Hermes harness snapshot', () => {
  it('discloses deterministic contracts without executing anything', () => {
    const first = build(settings());
    const second = build(settings());

    expect(first.hermes.fingerprint).toBe(second.hermes.fingerprint);
    expect(first.hermes.provider).toMatchObject({
      kind: 'ollama',
      provider: 'ollama',
      configured: true,
      routeCount: 2,
    });
    expect(first.hermes.toolsets.ids).toContain('memory');
    expect(first.hermes.prompt.tiers).toContain('skill-bundles');
    expect(first.hermes.prompt.tiers).toContain('session-search');
    expect(first.hermes.memory).toEqual({ agentChars: 2_200, userChars: 1_375 });
    expect(first.hermes.sessionSearch).toMatchObject({ terms: 4, rows: 20 });
    expect(first.hermes.skills.bundleIds).toContain('bundle_research');

    const serialised = JSON.stringify(first.hermes);
    expect(serialised).not.toContain('supersecret');
    expect(serialised).not.toContain('user:pass');
    expect(serialised).not.toContain('local-model');
  });

  it('reflects the deterministic system route when AI is unconfigured', () => {
    const snapshot = build(settings({ baseUrl: '', model: '' }));

    expect(snapshot.hermes.provider).toMatchObject({
      kind: 'system',
      configured: false,
      routeCount: 1,
    });
    expect(snapshot.aiReady).toBe(false);
  });

  it('hides web-search skills when the setting is disabled', () => {
    const snapshot = build(settings({ webSearch: false }));

    expect(snapshot.hermes.skills.visibleIds).not.toContain('skill_web_search');
  });
});
