import { describe, expect, it, vi } from 'vitest';

import { PluginEventBus } from '../events';
import { MCP_PLUGIN_PREFIX } from '../mcp-bridge';
import {
  isEntryPointAllowed,
  isReservedPluginId,
  RESERVED_PLUGIN_ID_PREFIXES,
  validateManifest,
} from '../manifest';
import { PluginPermissionError } from '../permissions';
import { createPluginSdk, type PluginSdkRegistry } from '../sdk';
import { PluginKeyValueStorage } from '../storage';
import { createHarness, makeManifest, rawManifest } from './helpers';

describe('trust restrictions', () => {
  it('reserves core identifiers and rejects built-in entry points for non-official plugins', () => {
    const reserved = `${RESERVED_PLUGIN_ID_PREFIXES[0]}demo`;
    expect(isReservedPluginId(reserved)).toBe(true);
    expect(isReservedPluginId(`${MCP_PLUGIN_PREFIX}alpha`)).toBe(false);

    const reservedManifest = makeManifest({
      pluginId: reserved,
      entryPoint: { kind: 'builtin', moduleId: 'demo-module' },
    });
    expect(isEntryPointAllowed(reservedManifest, 'official')).toBe(true);
    expect(isEntryPointAllowed(reservedManifest, 'verified')).toBe(false);
    expect(isEntryPointAllowed(reservedManifest, 'local')).toBe(false);

    const community = makeManifest({ pluginId: 'community.plugin' });
    expect(isEntryPointAllowed(community, 'untrusted')).toBe(true);
    expect(
      isEntryPointAllowed(
        makeManifest({
          pluginId: 'local.tool',
          entryPoint: { kind: 'builtin', moduleId: 'demo-module' },
        }),
        'community'
      )
    ).toBe(false);
    expect(
      isEntryPointAllowed(
        makeManifest({ pluginId: 'local.tool', entryPoint: { kind: 'mcp' } }),
        'local'
      )
    ).toBe(true);
  });

  it('refuses reserved ids and built-in entry points at untrusted trust levels', () => {
    const { registry } = createHarness();
    const reserved = `${RESERVED_PLUGIN_ID_PREFIXES[0]}demo`;

    expect(() =>
      registry.discover(
        makeManifest({ pluginId: reserved, entryPoint: { kind: 'builtin', moduleId: 'demo' } }),
        { trustLevel: 'community', source: 'catalog' }
      )
    ).toThrow(/reserved id or built-in entry point/);

    expect(() =>
      registry.discover(
        makeManifest({
          pluginId: 'local.tool',
          entryPoint: { kind: 'builtin', moduleId: 'demo' },
        }),
        { trustLevel: 'verified', source: 'catalog' }
      )
    ).toThrow(/reserved id or built-in entry point/);

    expect(
      registry.discover(
        makeManifest({
          pluginId: reserved,
          entryPoint: { kind: 'builtin', moduleId: 'demo' },
        }),
        { trustLevel: 'official', source: 'builtin' }
      ).pluginId
    ).toBe(reserved);
  });

  it('rejects declarative plugins that try to attach executable code', () => {
    const { registry } = createHarness();
    registry.registerImplementation('test.plugin', {
      activate() {
        throw new Error('should never run');
      },
    });

    expect(() =>
      registry.discover(makeManifest(), { trustLevel: 'local', source: 'local' })
    ).toThrow(/cannot have executable implementation code/);
  });

  it('cannot execute code from manifest fields or expose an evaluation surface', () => {
    expect(
      validateManifest(rawManifest({ entryPoint: { kind: 'script', file: './payload.js' } })).ok
    ).toBe(false);
    expect(validateManifest(rawManifest({ execute: 'globalThis.eval("1")' })).ok).toBe(false);

    const { permissions, events, persistence } = createHarness();
    const sdk = createPluginSdk({
      pluginId: 'test.plugin',
      manifest: makeManifest(),
      registry: {} as PluginSdkRegistry,
      permissions,
      events,
      storage: new PluginKeyValueStorage(persistence),
      requestApproval: async () => false,
      logger: () => undefined,
    });

    const keys = Object.keys(sdk);
    for (const forbidden of ['eval', 'require', 'import', 'Function', 'db', 'database']) {
      expect(keys).not.toContain(forbidden);
    }
  });

  it('gates SDK capabilities on manifest declarations and actual grants', async () => {
    const { permissions, events, persistence } = createHarness();
    const manifest = makeManifest({
      permissions: ['storage.read', 'network.access'],
      events: { emits: ['task.created'], listens: ['plugin.error'] },
    });
    const approved: string[] = [];
    const registry: PluginSdkRegistry = {
      getManifest: () => manifest,
      getRecord: () => null,
      hasPermission: (pluginId, permission) => permissions.has(pluginId, permission),
      approvePermissions: async (_pluginId, list) => {
        approved.push(...list);
      },
      registerTool: async () => () => undefined,
      getSettings: async () => ({}),
      setSetting: async () => undefined,
      deleteSetting: async () => undefined,
    };
    const logger = vi.fn();
    const sdk = createPluginSdk({
      pluginId: 'test.plugin',
      manifest,
      registry,
      permissions,
      events,
      storage: new PluginKeyValueStorage(persistence),
      requestApproval: async () => false,
      logger,
    });

    expect(() => sdk.events.subscribe('user.authenticated', () => undefined)).toThrow(
      /did not declare events.listens/
    );
    expect(() => sdk.events.emit('theme.changed', { mode: 'dark' })).toThrow(
      /did not declare events.emits/
    );
    await expect(sdk.storage.set('key', 'value')).rejects.toThrow(
      /did not declare the "storage.write" permission/
    );
    await expect(sdk.storage.get('key')).rejects.toThrow(PluginPermissionError);
    await expect(sdk.network.fetch('http://example.test')).rejects.toThrow(
      PluginPermissionError
    );
    await expect(sdk.permissions.request(['camera.access'], 'test')).rejects.toThrow(
      /did not declare the "camera.access" permission/
    );
    expect(await sdk.permissions.request(['network.access'], 'Need network')).toBe(false);

    await permissions.grant('test.plugin', ['network.access'], 'user', 'Granted for test.');
    await expect(sdk.network.fetch('http://example.test')).rejects.toThrow(/must use HTTPS/);

    const unsubscribe = sdk.events.subscribe('plugin.error', () => undefined);
    expect(events.listenerCount('test.plugin')).toBe(1);
    unsubscribe();
    expect(events.listenerCount('test.plugin')).toBe(0);
    sdk.logger.info('token=secret-value');
    expect(logger.mock.calls[0][0]).toContain('[redacted]');
    expect(approved).toEqual([]);
  });

  it('only grants runtime permission requests after explicit host approval', async () => {
    const harness = createHarness();
    const manifest = makeManifest({ permissions: ['network.access'] });
    const requestApproval = vi.fn(async () => true);
    const approvePermissions = vi.fn(async () => undefined);
    const sdk = createPluginSdk({
      pluginId: 'test.plugin',
      manifest,
      registry: {
        getManifest: () => manifest,
        getRecord: () => null,
        hasPermission: (pluginId, permission) => harness.permissions.has(pluginId, permission),
        approvePermissions,
        registerTool: async () => () => undefined,
        getSettings: async () => ({}),
        setSetting: async () => undefined,
        deleteSetting: async () => undefined,
      },
      permissions: harness.permissions,
      events: new PluginEventBus(),
      storage: new PluginKeyValueStorage(harness.persistence),
      requestApproval,
      logger: () => undefined,
    });

    expect(await sdk.permissions.request([], 'Nothing requested')).toBe(true);
    expect(await sdk.permissions.request(['network.access'], 'Need network')).toBe(true);
    expect(requestApproval).toHaveBeenCalledWith(['network.access'], 'Need network');
    expect(approvePermissions).toHaveBeenCalledWith(
      'test.plugin',
      ['network.access'],
      'Need network'
    );
  });
});
