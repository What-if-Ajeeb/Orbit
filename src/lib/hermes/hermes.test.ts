import { describe, expect, it, vi } from 'vitest';

import type { AiSettings } from '../ai/settings';
import { parseSkillManifest, WEB_SEARCH_SKILL_ID } from '../skills/manifest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-hermes-test' }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));
vi.mock('../agent-settings', () => ({ filterAllowedTools: (tools: unknown[]) => tools }));
vi.mock('../ai/tools', () => ({
  listAgentTools: () => [
    { name: 'create_task' },
    { name: 'list_tasks' },
    { name: 'memory_remember' },
    { name: 'mcp__mail_send' },
    { name: 'custom_tool' },
  ],
}));
vi.mock('../memory/prompt', () => ({ buildMemoryPromptSection: async () => 'Persistent memory: test fact' }));

const settings = (overrides: Partial<AiSettings> = {}): AiSettings => ({
  provider: 'ollama',
  mode: 'local',
  baseUrl: 'http://127.0.0.1:11434',
  model: '',
  apiKey: '',
  webSearch: true,
  ...overrides,
});

const taskSkill = parseSkillManifest({
  schemaVersion: 1,
  id: 'skill_tasks',
  name: 'Task workflow',
  description: 'Create and list tasks declaratively.',
  version: '1.0.0',
  enabled: true,
  autoLoad: true,
  capabilities: [
    {
      name: 'add',
      description: 'Add one task.',
      inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      steps: [{ tool: 'create_task', args: { title: '{{title}}' } }],
    },
  ],
});

const webSkill = parseSkillManifest({
  schemaVersion: 1,
  id: WEB_SEARCH_SKILL_ID,
  name: 'Web search',
  description: 'Search the web.',
  version: '1.0.0',
  enabled: true,
  autoLoad: true,
  capabilities: [
    {
      name: 'search',
      description: 'Run a search.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      steps: [{ tool: 'search_web' }],
    },
  ],
});

describe('provider runtime', () => {
  it('uses the deterministic system route when no provider is configured', async () => {
    const { buildProviderFallbackChain, resolveProviderRoute } = await import('./provider-runtime');
    const route = resolveProviderRoute(settings());

    expect(route).toMatchObject({ kind: 'system', configured: false, adapterId: null });
    expect(buildProviderFallbackChain(settings())).toHaveLength(1);
    expect(JSON.stringify(route)).not.toContain('apiKey');
  });

  it('resolves an adapter route and a finite fallback chain when configured', async () => {
    const { buildProviderFallbackChain, resolveProviderRoute } = await import('./provider-runtime');
    const configured = settings({ provider: 'gemini', mode: 'cloud', model: 'gemini-2.5-flash', apiKey: 'sk-test' });
    const route = resolveProviderRoute(configured);

    expect(route).toMatchObject({ kind: 'gemini', adapterId: 'gemini', configured: true, model: 'gemini-2.5-flash' });
    const chain = buildProviderFallbackChain(configured);
    expect(chain).toHaveLength(2);
    expect(chain[1]).toMatchObject({ kind: 'system', fallback: true, baseUrl: '', model: '' });
    expect(JSON.stringify(chain)).not.toContain('sk-test');
  });
});

describe('system deferral', () => {
  it('defers short greetings and acknowledgements only', async () => {
    const { isSmallTalk, smallTalkReply } = await import('./provider-runtime');

    expect(isSmallTalk('namaste')).toBe(true);
    expect(isSmallTalk('thanks!')).toBe(true);
    expect(isSmallTalk('theek hai')).toBe(true);
    expect(isSmallTalk('what is the weather?')).toBe(false);
    expect(isSmallTalk('add task pay bill')).toBe(false);
    expect(smallTalkReply('hello')).toContain('Namaste');
    expect(smallTalkReply('add task pay bill')).toBeNull();
  });
});

describe('skill disclosure', () => {
  it('hides unavailable and disabled-web-search skills', async () => {
    const { visibleSkillManifests } = await import('./skill-catalog');

    expect(visibleSkillManifests([taskSkill, webSkill], { availableTools: new Set(['create_task']) })).toEqual([taskSkill]);
    expect(visibleSkillManifests([taskSkill, webSkill], { webSearchDisabled: true })).toEqual([taskSkill]);
  });

  it('formats level 0, 1 and 2 views without argument values', async () => {
    const { buildSkillIndex, formatSkillIndex, viewSkill, viewSkillCapability } = await import('./skill-catalog');
    const index = formatSkillIndex(buildSkillIndex([taskSkill]));

    expect(index).toContain('skill_tasks');
    expect(index).toContain('add');
    expect(viewSkill([taskSkill], 'skill_tasks')).toContain('Add one task.');
    expect(viewSkillCapability([taskSkill], 'skill_tasks', 'add')).toContain('create_task');
  });
});

describe('toolsets', () => {
  it('groups the registry and filters by active grants', async () => {
    const { buildToolsets, availableToolNames } = await import('./toolsets');
    const groups = buildToolsets({
      grants: [
        { toolName: 'create_task', status: 'active' },
        { toolName: 'mcp__mail_send', status: 'revoked' },
      ],
    });
    const names = availableToolNames(groups);

    expect(names.has('create_task')).toBe(true);
    expect(names.has('mcp__mail_send')).toBe(false);
    expect(groups.find((group) => group.id === 'mcp')?.tools).toContain('mcp__mail_send');
  });
});

describe('frozen prompt bundle', () => {
  it('includes bounded, tiered sections with a stable fingerprint', async () => {
    const { buildHermesPromptBundle } = await import('./prompt-builder');
    const input = {
      db: {} as never,
      userId: 1,
      agentId: 'master',
      projectId: 'orbit-workspace',
      userName: 'Asha',
      agentName: 'Master Agent',
      now: 1_700_000_000_000,
      verifiedResults: ['- list_tasks: ok'],
      manifests: [taskSkill],
      webSearchDisabled: true,
      toolsetIds: ['tasks', 'memory'],
    };

    const first = await buildHermesPromptBundle(input);
    const second = await buildHermesPromptBundle(input);

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.snapshotId).toBe(first.fingerprint.slice(0, 16));
    expect(first.tiers).toContain('skill-index');
    expect(first.tiers).toContain('toolsets');
    expect(first.system).toContain('Persistent memory: test fact');
    expect(first.system).toContain('skill_tasks');
    expect(first.system).toContain('Available toolsets for this turn: tasks, memory.');
    expect(first.system).not.toContain(WEB_SEARCH_SKILL_ID);
  });
});
