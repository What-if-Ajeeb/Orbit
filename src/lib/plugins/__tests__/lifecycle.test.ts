import { describe, expect, it } from 'vitest';

import { MissingPluginPermissionsError } from '../permissions';
import { PluginUpdatePermissionError } from '../registry';
import { MemoryPluginPersistence } from '../persistence';
import type { PluginManifest } from '../types';
import { createHarness, makeManifest } from './helpers';

function builtinManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return makeManifest({
    pluginId: 'builtin.plugin',
    entryPoint: { kind: 'builtin', moduleId: 'builtin-module' },
    capabilities: ['events.subscribe', 'events.publish'],
    ...overrides,
  });
}

class FailingUpdatePersistence extends MemoryPluginPersistence {
  failNextTransaction = false;

  override async transaction<T>(task: () => Promise<T>): Promise<T> {
    const result = await super.transaction(task);

    if (this.failNextTransaction) {
      this.failNextTransaction = false;
      throw new Error('simulated update failure');
    }

    return result;
  }
}

describe('plugin lifecycle', () => {
  it('installs a plugin, approves permissions and records install artifacts', async () => {
    const { registry, permissions, persistence, events } = createHarness();
    const installed: string[] = [];
    events.subscribe('core', 'plugin.installed', (event) => {
      installed.push(event.payload.pluginId);
    });

    registry.discover(
      builtinManifest({
        permissions: ['storage.write'],
        settingsSchema: [{ key: 'mode', type: 'string', label: 'Mode' }],
      }),
      { trustLevel: 'official', source: 'builtin' }
    );

    const record = await registry.install('builtin.plugin', {
      approvePermissions: ['storage.write'],
    });

    expect(record.status).toBe('installed');
    expect(record.installedAt).toBe(1_000);
    expect(permissions.activeGrants('builtin.plugin')).toEqual(['storage.write']);
    expect(record.grantedPermissions).toEqual(['storage.write']);
    expect(installed).toEqual(['builtin.plugin']);
    expect((await persistence.loadPlugins())[0].manifestJson).toContain('builtin.plugin');
    expect(await persistence.listVersions('builtin.plugin')).toMatchObject([
      { version: '1.0.0' },
    ]);
    expect((await registry.installHistory('builtin.plugin')).map((row) => row.status)).toEqual([
      'succeeded',
      'started',
    ]);
  });

  it('rolls a failed install back to available with health and audit data', async () => {
    const { registry, events } = createHarness();
    const errors: string[] = [];
    events.subscribe('core', 'plugin.error', (event) => {
      errors.push(`${event.payload.hook}:${event.payload.error}`);
    });
    registry.registerImplementation('builtin.plugin', {
      hooks: {
        onInstall() {
          throw new Error('install exploded');
        },
      },
    });
    registry.discover(builtinManifest({ lifecycleHooks: ['onInstall'] }), {
      trustLevel: 'official',
      source: 'builtin',
    });

    await expect(registry.install('builtin.plugin')).rejects.toThrow(/onInstall failed/);

    expect(registry.getRecord('builtin.plugin')).toMatchObject({
      status: 'available',
      error: /onInstall failed: install exploded/,
    });
    expect(registry.getRecord('builtin.plugin')?.health).toMatchObject({
      status: 'degraded',
    });
    expect(registry.getRecord('builtin.plugin')?.health.failures).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toContain('onInstall:');
    expect((await registry.installHistory('builtin.plugin'))[0]).toMatchObject({
      action: 'install',
      status: 'failed',
    });
  });

  it('requires permission approval before enabling and runs hooks in order', async () => {
    const { registry, events, permissions } = createHarness();
    const calls: string[] = [];
    registry.registerImplementation('builtin.plugin', {
      hooks: {
        onEnable() {
          calls.push('onEnable');
        },
        onStart() {
          calls.push('onStart');
        },
      },
      activate(sdk) {
        calls.push('activate');
        sdk.events.subscribe('plugin.error', () => undefined);
      },
    });
    registry.discover(
      builtinManifest({
        permissions: ['network.access'],
        events: { emits: [], listens: ['plugin.error'] },
        lifecycleHooks: ['onEnable', 'onStart'],
      }),
      { trustLevel: 'official', source: 'builtin' }
    );
    await registry.install('builtin.plugin');

    await expect(registry.enable('builtin.plugin')).rejects.toThrow(
      MissingPluginPermissionsError
    );
    expect(registry.getRecord('builtin.plugin')?.status).toBe('installed');

    const record = await registry.enable('builtin.plugin', {
      approvePermissions: ['network.access'],
    });

    expect(calls).toEqual(['onEnable', 'onStart', 'activate']);
    expect(record.status).toBe('running');
    expect(record.enabled).toBe(true);
    expect(record.health.status).toBe('healthy');
    expect(record.lastStartedAt).toBe(1_000);
    expect(permissions.has('builtin.plugin', 'network.access')).toBe(true);
    expect(events.listenersFor('plugin.error')).toContain('builtin.plugin');
  });

  it('falls back to error state and disposes the SDK when activation fails', async () => {
    const { registry, events } = createHarness();
    registry.registerImplementation('builtin.plugin', {
      activate(sdk) {
        sdk.events.subscribe('plugin.error', () => undefined);
        throw new Error('activate exploded');
      },
    });
    registry.discover(
      builtinManifest({ events: { emits: [], listens: ['plugin.error'] } }),
      { trustLevel: 'official', source: 'builtin' }
    );
    await registry.install('builtin.plugin');

    await expect(registry.enable('builtin.plugin')).rejects.toThrow(/activate exploded/);

    expect(registry.getRecord('builtin.plugin')).toMatchObject({
      status: 'error',
      enabled: false,
      error: 'activate exploded',
    });
    expect(registry.getRecord('builtin.plugin')?.health.failures).toBe(1);
    expect(events.listenerCount('builtin.plugin')).toBe(0);
    expect((await registry.installHistory('builtin.plugin')).some((row) => row.action === 'enable' && row.status === 'succeeded')).toBe(false);
  });

  it('disables a running plugin even when a shutdown hook fails', async () => {
    const { registry, events } = createHarness();
    registry.registerImplementation('builtin.plugin', {
      hooks: {
        onStop() {
          throw new Error('stop exploded');
        },
      },
      activate(sdk) {
        sdk.events.subscribe('plugin.error', () => undefined);
      },
    });
    registry.discover(
      builtinManifest({
        lifecycleHooks: ['onStop'],
        events: { emits: [], listens: ['plugin.error'] },
      }),
      { trustLevel: 'official', source: 'builtin' }
    );
    await registry.install('builtin.plugin');
    await registry.enable('builtin.plugin');
    expect(events.listenerCount('builtin.plugin')).toBe(1);

    const record = await registry.disable('builtin.plugin');

    expect(record.status).toBe('disabled');
    expect(record.enabled).toBe(false);
    expect(record.error).toMatch(/onStop failed: stop exploded/);
    expect(record.health.status).toBe('degraded');
    expect(events.listenerCount('builtin.plugin')).toBe(0);
  });

  it('uninstalls, revokes permissions, clears listeners and can re-add from catalog', async () => {
    const { registry, permissions, persistence, events } = createHarness();
    const manifest = makeManifest({
      permissions: ['storage.read'],
      settingsSchema: [{ key: 'mode', type: 'string', label: 'Mode' }],
    });
    registry.registerCatalog(manifest, { trustLevel: 'local', source: 'local' });
    await registry.install('test.plugin', { approvePermissions: ['storage.read'] });
    await registry.setSetting('test.plugin', 'mode', 'fast');
    events.subscribe('test.plugin', 'plugin.error', () => undefined);

    await registry.uninstall('test.plugin', { deleteData: true });

    expect(registry.getRecord('test.plugin')).toMatchObject({
      status: 'available',
      enabled: false,
    });
    expect(permissions.has('test.plugin', 'storage.read')).toBe(false);
    expect(await persistence.listSettings('test.plugin')).toEqual([]);
    expect(events.listenerCount('test.plugin')).toBe(0);
    expect((await registry.installHistory('test.plugin')).some((row) => row.action === 'uninstall' && row.status === 'succeeded')).toBe(true);
    expect((await permissions.audit('test.plugin')).map((row) => row.event)).toContain(
      'permission_revoked'
    );
  });

  it('requires approval for permissions added by an update and revokes removed ones', async () => {
    const { registry, permissions } = createHarness();
    registry.discover(makeManifest({ permissions: ['storage.read'] }), {
      trustLevel: 'local',
      source: 'local',
    });
    await registry.install('test.plugin', { approvePermissions: ['storage.read'] });

    const added = makeManifest({
      version: '1.1.0',
      permissions: ['storage.read', 'ai.invoke'],
    });
    await expect(registry.update('test.plugin', added)).rejects.toThrow(
      PluginUpdatePermissionError
    );

    const updated = await registry.update('test.plugin', added, {
      approveAddedPermissions: ['ai.invoke'],
    });
    expect(updated.manifest.version).toBe('1.1.0');
    expect(updated.status).toBe('disabled');
    expect(permissions.activeGrants('test.plugin')).toEqual(['ai.invoke', 'storage.read']);

    await registry.update(
      'test.plugin',
      makeManifest({ version: '1.2.0', permissions: ['ai.invoke'] })
    );

    expect(permissions.activeGrants('test.plugin')).toEqual(['ai.invoke']);
    expect(
      (await registry.permissionAudit('test.plugin')).filter(
        (row) => row.event === 'permission_revoked'
      )
    ).toHaveLength(1);
  });

  it('restores the previous manifest, permissions and data when an update fails', async () => {
    const persistence = new FailingUpdatePersistence();
    const { registry, permissions } = createHarness({ persistence });
    const base = builtinManifest({
      permissions: ['storage.read', 'storage.write'],
      settingsSchema: [{ key: 'mode', type: 'string', label: 'Mode' }],
    });
    registry.discover(base, { trustLevel: 'official', source: 'builtin' });
    await registry.install('builtin.plugin', {
      approvePermissions: ['storage.read', 'storage.write'],
    });
    await registry.setSetting('builtin.plugin', 'mode', 'original');

    persistence.failNextTransaction = true;
    await expect(
      registry.update(
        'builtin.plugin',
        builtinManifest({
          version: '1.1.0',
          permissions: ['storage.write', 'ai.invoke'],
        }),
        { approveAddedPermissions: ['ai.invoke'] }
      )
    ).rejects.toThrow(/simulated update failure/);

    expect(registry.getManifest('builtin.plugin').version).toBe('1.0.0');
    expect(permissions.activeGrants('builtin.plugin')).toEqual([
      'storage.read',
      'storage.write',
    ]);
    expect(await registry.getSettings('builtin.plugin')).toMatchObject({ mode: 'original' });
    expect(await persistence.latestBackup('builtin.plugin')).toMatchObject({
      fromVersion: '1.0.0',
      toVersion: '1.1.0',
    });
    expect((await registry.installHistory('builtin.plugin')).map((row) => row.action)).toContain(
      'rollback'
    );
  });
});
