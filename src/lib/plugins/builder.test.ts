import { describe, expect, it, vi } from 'vitest';

import {
  BUILDER_DRAFT_VERSION,
  buildManifest,
  createBuilderAction,
  createEmptyDraft,
  validateAndBuild,
  validateDraft,
  type BuilderAction,
  type BuilderDraft,
} from './builder';
import {
  appendBuilderLog,
  deleteBuilderDraft,
  duplicateBuilderDraft,
  getBuilderDraft,
  loadBuilderDrafts,
  loadBuilderLogs,
  normalizeDraft,
  saveBuilderDraft,
} from './builder-store';
import {
  exportBuilderManifest,
  installBuilderDraft,
} from './builder-service';
import { createHarness, type Harness } from './__tests__/helpers';
import { MemoryPluginPersistence } from './persistence';
import type { PluginPlatformRuntime } from './platform';

function makeAction(overrides: Partial<BuilderAction> = {}): BuilderAction {
  return {
    ...createBuilderAction(0),
    id: 'echo',
    name: 'Echo',
    description: 'Return a value.',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
    },
    outputSchema: {
      type: 'object',
      properties: { result: { type: 'string' } },
      required: ['result'],
    },
    ...overrides,
  };
}

function makeDraft(overrides: Partial<BuilderDraft> = {}): BuilderDraft {
  return {
    ...createEmptyDraft(1_000),
    schemaVersion: BUILDER_DRAFT_VERSION,
    pluginId: 'local.test.plugin',
    name: 'Test Builder Plugin',
    description: 'A plugin built in the app.',
    author: 'Local Creator',
    version: '1.0.0',
    capabilities: ['tools.ai'],
    actions: [makeAction()],
    ...overrides,
  };
}

function fakePlatform(harness: Harness): PluginPlatformRuntime {
  return {
    persistence: harness.persistence,
    permissions: harness.permissions,
    registry: harness.registry,
    events: harness.events,
    platform: 'android',
    appVersion: '1.10.6',
  } as unknown as PluginPlatformRuntime;
}

describe('builder manifest validation', () => {
  it('rejects an empty draft with clear errors', () => {
    const result = validateAndBuild(createEmptyDraft());
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Plugin ID|name|description|author/i);
  });

  it('produces a canonical v1 manifest that passes the shared validator', () => {
    const result = validateAndBuild(makeDraft());
    expect(result.ok).toBe(true);
    expect(result.manifest).toBeDefined();
    expect(result.manifest?.manifestVersion).toBe(1);
    expect(result.manifest?.entryPoint).toEqual({
      kind: 'declarative',
      screen: 'plugin-home',
    });
    expect(result.manifest?.publisher.verified).toBe(false);
    expect(result.manifest?.mcpTools).toHaveLength(1);
    expect(result.manifest?.mcpTools[0]?.name).toBe('echo');
  });

  it('rejects reserved plugin ids', () => {
    const result = validateDraft(makeDraft({ pluginId: 'orbit.core.evil' }));
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/reserved/i);
  });

  it('rejects secret values stored in a draft', () => {
    const result = validateDraft(
      makeDraft({
        environment: [{ key: 'API_TOKEN', secret: true, value: 'super-secret' }],
      })
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/must not be stored/i);
  });

  it('adds AI permission for declared actions without an execution permission', () => {
    const manifest = buildManifest(
      makeDraft({
        environment: [{ key: 'API_TOKEN', secret: true }],
        integrations: ['mcp:alpha'],
      })
    );

    expect(manifest.permissions).toContain('ai.invoke');
    expect(manifest.permissions).not.toContain('sandbox.execute');
    expect(manifest.permissions).toContain('credentials.request');
    expect(manifest.permissions).toContain('mcp.connect');
    expect(manifest.capabilities).toContain('tools.ai');
    expect(manifest.capabilities).toContain('integration.mcp');
    expect(manifest.dependencies).toEqual([]);
  });

  it('emits only inert MCP tool metadata, never executable code or programs', () => {
    const manifest = buildManifest(makeDraft());
    expect(manifest.entryPoint.kind).toBe('declarative');
    expect(manifest.mcpTools).toEqual([
      {
        name: 'echo',
        description: 'Return a value.',
        inputSchema: expect.any(Object),
        outputSchema: expect.any(Object),
      },
    ]);
    expect(JSON.stringify(manifest)).not.toMatch(
      /"program"|"instructions"|"handler"|sandbox\.execute/
    );
  });

  it('exports valid JSON and refuses invalid drafts', () => {
    const json = exportBuilderManifest(makeDraft());
    expect(JSON.parse(json)).toMatchObject({
      manifestVersion: 1,
      pluginId: 'local.test.plugin',
    });
    expect(() => exportBuilderManifest(makeDraft({ pluginId: '' }))).toThrow();
  });
});

describe('draft lifecycle', () => {
  it('round-trips a draft through the canonical persistence seam', async () => {
    const persistence = new MemoryPluginPersistence();
    const draft = makeDraft();

    const saved = await saveBuilderDraft(persistence, draft);
    expect(saved.updatedAt).toBeGreaterThan(0);

    const loaded = await getBuilderDraft(persistence, draft.pluginId);
    expect(loaded).not.toBeNull();
    expect(loaded?.name).toBe(draft.name);
    expect(loaded?.actions).toHaveLength(1);
  });

  it('drops unknown fields, secret values and execution handlers on load', () => {
    const raw = {
      ...makeDraft(),
      schemaVersion: BUILDER_DRAFT_VERSION,
      arbitraryField: 'ignored',
      environment: [{ key: 'TOKEN', secret: true, value: 'must-not-survive' }],
      actions: [
        {
          ...makeAction(),
          arbitrary: true,
          handler: { kind: 'executable', code: 'evil()' },
        },
      ],
    };
    const normalized = normalizeDraft(raw);

    expect(normalized).not.toBeNull();
    expect(normalized).not.toHaveProperty('arbitraryField');
    expect(normalized?.environment[0].value).toBeUndefined();
    expect(normalized?.actions[0]).not.toHaveProperty('handler');
    expect(normalized?.actions[0]).not.toHaveProperty('arbitrary');
  });

  it('rejects reserved ids when loading persisted drafts', () => {
    expect(normalizeDraft(makeDraft({ pluginId: 'orbit.core.reserved' }))).toBeNull();
  });

  it('duplicates and deletes drafts', async () => {
    const persistence = new MemoryPluginPersistence();
    await saveBuilderDraft(persistence, makeDraft());

    const copy = await duplicateBuilderDraft(
      persistence,
      'local.test.plugin',
      'local.test.plugin.copy',
      'Copy'
    );
    expect(copy.pluginId).toBe('local.test.plugin.copy');
    expect(await loadBuilderDrafts(persistence)).toHaveLength(2);

    await deleteBuilderDraft(persistence, 'local.test.plugin');
    expect(await loadBuilderDrafts(persistence)).toHaveLength(1);
  });

  it('redacts secrets in persisted logs', async () => {
    const persistence = new MemoryPluginPersistence();
    await appendBuilderLog(persistence, {
      pluginId: 'local.test.plugin',
      actionId: 'echo',
      level: 'error',
      message: 'token=super-secret-token failed',
    });

    const logs = await loadBuilderLogs(persistence, 'local.test.plugin');
    expect(logs).toHaveLength(1);
    expect(logs[0].message).not.toContain('super-secret-token');
  });
});

describe('builder installation', () => {
  it('does not install when approval is denied', async () => {
    const harness = createHarness();
    const platform = fakePlatform(harness);
    const approvals = {
      requestInstall: vi.fn(async () => false),
      requestPermissions: vi.fn(async () => false),
    };

    const result = await installBuilderDraft(platform, makeDraft(), {
      approvals,
      persistence: harness.persistence,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/cancelled/i);
    expect(harness.registry.getRecord('local.test.plugin')).toBeNull();
  });

  it('refuses to install over a catalog or core plugin id', async () => {
    const harness = createHarness();
    const platform = fakePlatform(harness);
    harness.registry.discover(buildManifest(makeDraft()), {
      trustLevel: 'official',
      source: 'catalog',
    });

    const result = await installBuilderDraft(platform, makeDraft(), {
      approvals: {
        requestInstall: vi.fn(async () => true),
        requestPermissions: vi.fn(async () => true),
      },
      persistence: harness.persistence,
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/already used/i);
    expect(harness.registry.getRecord('local.test.plugin')?.trustLevel).toBe('official');
  });

  it('installs through the canonical registry after approval', async () => {
    const harness = createHarness();
    const platform = fakePlatform(harness);
    const approvals = {
      requestInstall: vi.fn(async () => true),
      requestPermissions: vi.fn(async () => true),
    };

    const result = await installBuilderDraft(platform, makeDraft(), {
      approvals,
      persistence: harness.persistence,
    });

    expect(result.ok).toBe(true);
    expect(result.record).toBeDefined();
    expect(result.record?.status).toBe('installed');
    expect(approvals.requestInstall).toHaveBeenCalledTimes(1);
    expect(harness.toolHost.tools.size).toBe(0);
  });
});
