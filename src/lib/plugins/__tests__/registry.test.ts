import { describe, expect, it } from 'vitest';

import {
  DuplicatePluginError,
  PluginInUseError,
  PLUGIN_STATE_TRANSITIONS,
} from '../registry';
import type { PersistedPlugin } from '../types';
import { createHarness, makeManifest } from './helpers';

function persisted(
  manifest: ReturnType<typeof makeManifest>,
  overrides: Partial<PersistedPlugin> = {}
): PersistedPlugin {
  return {
    manifest,
    manifestJson: JSON.stringify(manifest),
    trustLevel: 'local',
    source: 'local',
    status: 'installed',
    enabled: false,
    installedAt: 1,
    updatedAt: 1,
    lastStartedAt: null,
    lastStoppedAt: null,
    error: null,
    health: { status: 'unknown', failures: 0, lastError: null, lastCheckedAt: null },
    legacy: false,
    ...overrides,
  };
}

describe('plugin registry', () => {
  it('discovers validated manifests once, emits discovery and notifies subscribers', () => {
    const { registry, events } = createHarness();
    const discovered: string[] = [];
    events.subscribe('core', 'plugin.discovered', (event) => {
      discovered.push(event.payload.pluginId);
    });
    let notifications = 0;
    registry.subscribe(() => {
      notifications += 1;
    });

    const manifest = registry.discover(makeManifest(), {
      trustLevel: 'local',
      source: 'local',
    });

    expect(manifest.pluginId).toBe('test.plugin');
    expect(registry.getManifest('test.plugin')).toEqual(manifest);
    expect(registry.getRecord('test.plugin')).toMatchObject({
      status: 'available',
      enabled: false,
      grantedPermissions: [],
      legacy: false,
    });
    expect(registry.listAvailable().map((record) => record.manifest.pluginId)).toEqual([
      'test.plugin',
    ]);
    expect(discovered).toEqual(['test.plugin']);
    expect(notifications).toBe(1);

    expect(() =>
      registry.discover(makeManifest(), { trustLevel: 'local', source: 'local' })
    ).toThrow(DuplicatePluginError);
    expect(() => registry.discover({ bad: true }, { trustLevel: 'local', source: 'local' })).toThrow(
      /Invalid plugin manifest/
    );
  });

  it('enforces compatibility and contribution policy at discovery time', () => {
    const { registry } = createHarness({ platform: 'android', appVersion: '1.10.6' });

    expect(() =>
      registry.discover(makeManifest({ platformSupport: ['ios'] }), {
        trustLevel: 'local',
        source: 'local',
      })
    ).toThrow(/does not support the android platform/);

    expect(() =>
      registry.discover(makeManifest({ minimumOrbitVersion: '99.0.0' }), {
        trustLevel: 'local',
        source: 'local',
      })
    ).toThrow(/requires Orbit 99.0.0 or newer/);

    expect(() =>
      registry.discover(
        makeManifest({
          pluginId: 'ui.plugin',
          routes: [{ id: 'home', screen: 'plugin-home', title: 'Home' }],
        }),
        { trustLevel: 'local', source: 'local' }
      )
    ).toThrow(/declares UI contributions but does not request/);

    expect(() =>
      registry.discover(
        makeManifest({
          pluginId: 'events.plugin',
          events: { emits: ['thing.happened'], listens: [] },
        }),
        { trustLevel: 'local', source: 'local' }
      )
    ).toThrow(/declares events without an events capability/);

    expect(() =>
      registry.discover(
        makeManifest({
          pluginId: 'tools.plugin',
          mcpTools: [{ name: 'search', description: 'Search things' }],
        }),
        { trustLevel: 'local', source: 'local' }
      )
    ).toThrow(/declares MCP tools but does not request/);
  });

  it('keeps installed manifests authoritative over catalog updates and reports updates', async () => {
    const { registry } = createHarness();
    const installed = makeManifest({ version: '1.0.0' });
    const newer = makeManifest({ version: '2.0.0' });

    registry.discover(installed, { trustLevel: 'local', source: 'local' });
    registry.registerCatalog(newer, {
      trustLevel: 'local',
      source: 'local',
      readme: 'Newer version.',
    });
    await registry.install('test.plugin');

    expect(registry.getManifest('test.plugin').version).toBe('1.0.0');
    expect(registry.getSummaries()[0].hasUpdate).toBe(true);
    expect(registry.getCatalogEntries()[0]).toMatchObject({
      installedVersion: '1.0.0',
      availableVersion: '2.0.0',
      hasUpdate: true,
      readme: 'Newer version.',
    });
    expect(() =>
      registry.registerCatalog({ nope: true }, { trustLevel: 'local', source: 'local' })
    ).toThrow(/Invalid catalog manifest/);
  });

  it('exposes the declared state machine and rejects out-of-order operations', async () => {
    const { registry } = createHarness();

    expect(PLUGIN_STATE_TRANSITIONS.discovered).toEqual(['available']);
    expect(PLUGIN_STATE_TRANSITIONS.available).toEqual(['installing']);
    expect(PLUGIN_STATE_TRANSITIONS.running).toContain('uninstalling');
    expect(PLUGIN_STATE_TRANSITIONS.running).not.toContain('installing');

    registry.discover(makeManifest(), { trustLevel: 'local', source: 'local' });
    await expect(registry.enable('test.plugin')).rejects.toThrow(/must be installed/);
    await expect(registry.update('test.plugin', makeManifest())).rejects.toThrow(
      /is not installed/
    );
    await expect(registry.install('unknown.plugin')).rejects.toThrow(/not available/);
  });

  it('resolves required dependencies from the catalog and protects installed dependencies', async () => {
    const { registry } = createHarness();
    registry.registerCatalog(makeManifest({ pluginId: 'dep.plugin', name: 'Dep' }), {
      trustLevel: 'local',
      source: 'local',
    });
    registry.registerCatalog(
      makeManifest({
        pluginId: 'main.plugin',
        name: 'Main',
        dependencies: [{ pluginId: 'dep.plugin', version: '^1.0.0' }],
      }),
      { trustLevel: 'local', source: 'local' }
    );

    await registry.install('main.plugin');
    expect(registry.getRecord('dep.plugin')?.status).toBe('installed');
    expect(registry.getRecord('main.plugin')?.status).toBe('installed');
    await expect(registry.enable('main.plugin')).rejects.toThrow(/Enable dependency/);

    await registry.enable('dep.plugin');
    await registry.enable('main.plugin');
    expect(registry.getStartupOrder()).toEqual(['dep.plugin', 'main.plugin']);
    await expect(registry.uninstall('dep.plugin')).rejects.toThrow(PluginInUseError);
  });

  it('reports missing dependencies, dependency cycles and optional version conflicts', async () => {
    const { registry } = createHarness();

    registry.discover(
      makeManifest({
        pluginId: 'lonely.plugin',
        dependencies: [{ pluginId: 'absent.plugin', version: '^1.0.0' }],
      }),
      { trustLevel: 'local', source: 'local' }
    );
    await expect(registry.install('lonely.plugin')).rejects.toThrow(/is not installed/);

    registry.discover(
      makeManifest({
        pluginId: 'first.plugin',
        dependencies: [{ pluginId: 'second.plugin', version: '^1.0.0' }],
      }),
      { trustLevel: 'local', source: 'local' }
    );
    expect(() =>
      registry.discover(
        makeManifest({
          pluginId: 'second.plugin',
          dependencies: [{ pluginId: 'first.plugin', version: '^1.0.0' }],
        }),
        { trustLevel: 'local', source: 'local' }
      )
    ).toThrow(/Dependency cycle detected/);

    registry.registerCatalog(makeManifest({ pluginId: 'optional.plugin', name: 'Optional' }), {
      trustLevel: 'local',
      source: 'local',
    });
    await registry.install('optional.plugin');
    registry.discover(
      makeManifest({
        pluginId: 'consumer.plugin',
        optionalDependencies: [{ pluginId: 'optional.plugin', version: '^2.0.0' }],
      }),
      { trustLevel: 'local', source: 'local' }
    );
    await expect(registry.install('consumer.plugin')).rejects.toThrow(
      /Plugin "optional\.plugin" is version 1\.0\.0, but \^2\.0\.0 is required/
    );
  });

  it('adopts existing integrations and refreshes their record', async () => {
    const { registry } = createHarness();
    const manifest = makeManifest({
      pluginId: 'orbit.core.demo',
      entryPoint: { kind: 'builtin', moduleId: 'demo-module' },
    });

    await expect(
      registry.adopt(manifest, { trustLevel: 'local', source: 'local' })
    ).rejects.toThrow(/cannot be adopted at trust level \"local\"/);

    const record = await registry.adopt(manifest, {
      trustLevel: 'official',
      source: 'builtin',
    });
    expect(record).toMatchObject({ status: 'running', enabled: true });
    expect(record.health.status).toBe('healthy');

    const updated = await registry.adopt(
      makeManifest({
        pluginId: 'orbit.core.demo',
        version: '1.1.0',
        entryPoint: { kind: 'builtin', moduleId: 'demo-module' },
      }),
      { trustLevel: 'official', source: 'builtin', status: 'disabled', enabled: false }
    );
    expect(updated.manifest.version).toBe('1.1.0');
    expect(updated.status).toBe('disabled');
    expect((await registry.installHistory('orbit.core.demo')).filter((row) => row.action === 'install')).toHaveLength(1);
  });

  it('restores persisted records safely and reports interrupted operations', async () => {
    const { registry } = createHarness();

    const running = makeManifest({ pluginId: 'running.plugin', name: 'Running' });
    const interrupted = makeManifest({ pluginId: 'interrupted.plugin', name: 'Interrupted' });
    const invalid = makeManifest({ pluginId: 'invalid.plugin' });

    expect(
      await registry.restore([
        persisted(running, { status: 'running', enabled: true }),
        persisted(interrupted, { status: 'installing', enabled: false }),
        persisted({ ...invalid, version: 'broken' }),
      ])
    ).toEqual(['running.plugin']);

    expect(registry.getRecord('running.plugin')).toMatchObject({
      status: 'disabled',
      enabled: false,
    });
    expect(registry.getRecord('interrupted.plugin')).toMatchObject({
      status: 'disabled',
      error: /interrupted during an operation/,
    });
    const history = await registry.installHistory('interrupted.plugin');
    expect(history[0]).toMatchObject({ action: 'recovered', status: 'succeeded' });
    expect((await registry.installHistory('invalid.plugin'))[0].status).toBe('failed');
  });

  it('accepts acyclic manifests and rejects dependency cycles', () => {
    const { registry } = createHarness();

    expect(() =>
      registry.discover(makeManifest(), { trustLevel: 'local', source: 'local' })
    ).not.toThrow();

    registry.discover(
      makeManifest({
        pluginId: 'cycle.a',
        dependencies: [{ pluginId: 'cycle.b', version: '^1.0.0' }],
      }),
      { trustLevel: 'local', source: 'local' }
    );

    expect(() =>
      registry.discover(
        makeManifest({
          pluginId: 'cycle.b',
          dependencies: [{ pluginId: 'cycle.a', version: '^1.0.0' }],
        }),
        { trustLevel: 'local', source: 'local' }
      )
    ).toThrow(/Dependency cycle detected/);
  });
});
