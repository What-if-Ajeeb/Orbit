import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PluginApprovalService } from './approvals';
import {
  buildDemandPlan,
  DEMAND_STATE_KEY,
  DEMAND_STATE_PLUGIN_ID,
  inferDemandCapabilities,
  searchDemandRegistry,
  SmartPluginInstaller,
} from './demand';
import {
  createHarness,
  makeManifest,
  mcpServer,
  type Harness,
} from './__tests__/helpers';
import { PluginKeyValueStorage } from './storage';
import type { PluginManifest } from './types';

const GITHUB_ID = 'trusted.github';

function githubManifest(): PluginManifest {
  return makeManifest({
    pluginId: GITHUB_ID,
    name: 'GitHub Tools',
    version: '1.2.0',
    description: 'Review GitHub repositories, issues and pull requests.',
    category: 'tool',
    publisher: { id: 'orbit', name: 'ORBIT', verified: true },
    capabilities: ['tools.ai'],
    permissions: ['ai.invoke', 'network.access'],
    mcpTools: [
      {
        name: 'github_review_pr',
        description: 'Review a GitHub pull request and summarize changes.',
      },
    ],
  });
}

function registerGithub(harness: Harness, manifest = githubManifest()): void {
  harness.registry.registerCatalog(manifest, {
    trustLevel: 'verified',
    source: 'catalog',
    readme: 'GitHub repository and pull request tools for agent work.',
  });
}

function makeApprovals(approved = true) {
  return {
    requestInstall: vi.fn(async () => approved),
  } as unknown as Pick<PluginApprovalService, 'requestInstall'> & {
    requestInstall: ReturnType<typeof vi.fn>;
  };
}

describe('demand capability inference', () => {
  it('infers learning capabilities only in learn mode', () => {
    expect(inferDemandCapabilities('Te me DSA sorting problems samjhao.', 'learn')).toContain(
      'learn_dsa'
    );
    expect(
      inferDemandCapabilities('Te me DSA sorting problems samjhao.', 'learn')
    ).not.toContain('agent_github');
  });

  it('infers agent capabilities from task text', () => {
    expect(inferDemandCapabilities('Review the GitHub pull request and run tests.', 'agent')).toEqual(
      expect.arrayContaining(['agent_github', 'agent_testing'])
    );
    expect(inferDemandCapabilities('Write a poem about rain.', 'agent')).toEqual([]);
  });

  it('does not infer a capability from a substring', () => {
    expect(inferDemandCapabilities('This is the latest update.', 'agent')).toEqual([]);
  });
});

describe('trusted demand registry search', () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
  });

  it('selects verified catalog plugins and ignores unverified publishers', () => {
    registerGithub(harness);
    harness.registry.registerCatalog(
      makeManifest({
        pluginId: 'community.github',
        name: 'Community GitHub clone',
        description: 'GitHub issue tools from an unverified publisher.',
      }),
      { trustLevel: 'community', source: 'catalog' }
    );

    const results = searchDemandRegistry({
      registry: harness.registry,
      capability: 'agent_github',
    });

    expect(results.map((item) => item.pluginId)).toEqual([GITHUB_ID]);
    expect(results[0].publisherVerified).toBe(true);
    expect(results[0].sensitivePermissions).toContain('ai.invoke');
  });

  it('includes configured MCP servers without leaking tokens', () => {
    const results = searchDemandRegistry({
      registry: harness.registry,
      servers: [
        mcpServer({
          id: 'github_mcp',
          name: 'GitHub MCP',
          url: 'https://github.example.test/mcp',
          token: 'secret-token-123',
        }),
      ],
      capability: 'agent_github',
    });

    expect(results).toHaveLength(1);
    expect(results[0].registry).toBe('configured-mcp');
    expect(JSON.stringify(results[0])).not.toContain('secret-token-123');
  });

  it('skips disabled MCP servers', () => {
    const results = searchDemandRegistry({
      registry: harness.registry,
      servers: [mcpServer({ name: 'GitHub MCP', enabled: false })],
      capability: 'agent_github',
    });

    expect(results).toEqual([]);
  });

  it('rejects an incompatible candidate during plan validation', () => {
    registerGithub(harness);
    const candidate = searchDemandRegistry({
      registry: harness.registry,
      capability: 'agent_github',
    })[0];
    const plan = buildDemandPlan({
      candidate: { ...candidate, compatible: false },
      capability: 'agent_github',
      mode: 'agent',
      reason: 'Review a pull request',
      registry: harness.registry,
    });

    expect(plan.ok).toBe(false);
    if (plan.ok) return;
    expect(plan.errors.join(' ')).toContain('not compatible');
  });

  it('builds an approval plan with dependencies and permissions', () => {
    registerGithub(harness);
    const candidate = searchDemandRegistry({
      registry: harness.registry,
      capability: 'agent_github',
    })[0];
    const plan = buildDemandPlan({
      candidate,
      capability: 'agent_github',
      mode: 'agent',
      reason: 'Review two GitHub pull requests',
      registry: harness.registry,
    });

    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.plan.pluginId).toBe(GITHUB_ID);
    expect(plan.plan.permissions).toEqual(['ai.invoke', 'network.access']);
    expect(plan.plan.sensitivePermissions).toEqual(['ai.invoke']);
    expect(plan.plan.steps.join(' ')).toContain('Install GitHub Tools 1.2.0');
    expect(plan.plan.steps.join(' ')).toContain('Grant only the listed access');
  });
});

describe('SmartPluginInstaller', () => {
  let harness: Harness;
  let storage: PluginKeyValueStorage;
  let now: number;

  beforeEach(() => {
    now = 10_000;
    harness = createHarness({ now: () => now });
    storage = new PluginKeyValueStorage(harness.persistence, 1024 * 1024, () => now);
  });

  function installer(approved = true, idleMs = 1_000) {
    const approvals = makeApprovals(approved);

    return {
      approvals,
      instance: new SmartPluginInstaller({
        registry: harness.registry,
        permissions: harness.permissions,
        approvals,
        storage,
        listServers: async () => [],
        now: () => now,
        idleMs,
      }),
    };
  }

  it('asks for approval, installs, enables, and then reuses the plugin', async () => {
    registerGithub(harness);
    const { approvals, instance } = installer();

    const first = await instance.resolve({
      task: 'Review the GitHub pull request',
      mode: 'agent',
      agentId: 'research',
    });

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.action).toBe('installed');
    expect(approvals.requestInstall).toHaveBeenCalledTimes(1);
    expect(approvals.requestInstall).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: GITHUB_ID,
        capability: 'agent_github',
        pluginVersion: '1.2.0',
      })
    );
    expect(harness.registry.getRecord(GITHUB_ID)?.status).toBe('running');

    const second = await instance.resolve({
      task: 'Review another GitHub pull request',
      mode: 'agent',
      agentId: 'research',
    });

    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.action).toBe('reused');
    expect(approvals.requestInstall).toHaveBeenCalledTimes(1);

    const state = await instance.getState();
    expect(state.autoInstalled[GITHUB_ID].usageCount).toBe(2);
    expect(state.usage).toHaveLength(2);
  });

  it('updates an installed plugin after approval instead of reinstalling it', async () => {
    const oldManifest = { ...githubManifest(), version: '1.1.0' };
    registerGithub(harness, oldManifest);
    await harness.registry.install(GITHUB_ID, {
      approvePermissions: oldManifest.permissions,
    });

    registerGithub(harness, githubManifest());
    const { approvals, instance } = installer();

    const result = await instance.resolve({
      task: 'Review the GitHub pull request',
      mode: 'agent',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.action).toBe('updated');
    expect(result.version).toBe('1.2.0');
    expect(harness.registry.getRecord(GITHUB_ID)?.manifest.version).toBe('1.2.0');
    expect(approvals.requestInstall).toHaveBeenCalledWith(
      expect.objectContaining({ requiresUpdate: true })
    );

    const state = await instance.getState();
    expect(state.usage[0].status).toBe('updated');
    expect(state.autoInstalled[GITHUB_ID].version).toBe('1.2.0');
  });

  it('installs nothing when the user denies the plan', async () => {
    registerGithub(harness);
    const { instance } = installer(false);

    const result = await instance.resolve({
      task: 'Review the GitHub pull request',
      mode: 'agent',
    });

    expect(result).toMatchObject({ ok: false, code: 'denied' });
    expect(harness.registry.getRecord(GITHUB_ID)?.status).toBe('available');

    const state = await instance.getState();
    expect(state.usage[0].status).toBe('denied');
    expect(await storage.get(DEMAND_STATE_PLUGIN_ID, DEMAND_STATE_KEY)).not.toBeNull();
  });

  it('reports no capability for an ordinary conversation', async () => {
    const { instance, approvals } = installer();

    const result = await instance.resolve({
      task: 'Hello, how are you?',
      mode: 'agent',
    });

    expect(result).toMatchObject({ ok: false, code: 'no-capability' });
    expect(approvals.requestInstall).not.toHaveBeenCalled();
  });

  it('disables an unused auto-installed plugin but never a user-installed plugin', async () => {
    registerGithub(harness);
    const { instance } = installer();

    await instance.resolve({ task: 'Review the GitHub pull request', mode: 'agent' });

    const userManifest = githubManifest();
    harness.registry.registerCatalog(
      {
        ...userManifest,
        pluginId: 'user.github',
        name: 'User GitHub Plugin',
        mcpTools: [],
      },
      { trustLevel: 'verified', source: 'catalog' }
    );
    await harness.registry.install('user.github', {
      approvePermissions: ['ai.invoke', 'network.access'],
    });
    await harness.registry.enable('user.github');

    now += 70_000;
    const disabled = await instance.disableUnused();

    expect(disabled).toEqual([GITHUB_ID]);
    expect(harness.registry.getRecord(GITHUB_ID)?.enabled).toBe(false);
    expect(harness.registry.getRecord('user.github')?.enabled).toBe(true);

    await instance.forget(GITHUB_ID);
    expect((await instance.getState()).autoInstalled[GITHUB_ID]).toBeUndefined();
  });
});
