import { describe, expect, it } from 'vitest';

import {
  isPluginPermission,
  isSensitivePermission,
  permissionRisk,
  PluginPermissionError,
  PluginPermissionManager,
} from '../permissions';
import { MemoryPluginPersistence } from '../persistence';
import { createHarness } from './helpers';

describe('plugin permissions', () => {
  it('is default-deny even for declared permissions', () => {
    const { permissions } = createHarness();

    expect(permissions.activeGrants('test.plugin')).toEqual([]);
    expect(permissions.has('test.plugin', 'network.access')).toBe(false);
    expect(permissions.missing('test.plugin', ['network.access', 'storage.read'])).toEqual([
      'network.access',
      'storage.read',
    ]);
    expect(() => permissions.assert('test.plugin', 'network.access')).toThrow(
      PluginPermissionError
    );
  });

  it('loads persisted grants once and keeps later writes in memory', async () => {
    const persistence = new MemoryPluginPersistence();
    await persistence.upsertPermission({
      pluginId: 'test.plugin',
      permission: 'storage.read',
      granted: true,
      source: 'migration',
      grantedAt: 10,
      revokedAt: null,
    });
    const permissions = new PluginPermissionManager(persistence, () => 20);

    await permissions.initialize();
    await permissions.initialize();

    expect(permissions.has('test.plugin', 'storage.read')).toBe(true);
    expect(permissions.activeGrants('test.plugin')).toEqual(['storage.read']);
    expect(permissions.hasEverGranted('test.plugin', 'storage.read')).toBe(true);
  });

  it('grants idempotently and audits only newly granted permissions', async () => {
    const { permissions, persistence } = createHarness({ now: () => 123 });

    const first = await permissions.grant(
      'test.plugin',
      ['storage.read', 'storage.write'],
      'core',
      'Built-in grant.'
    );
    const second = await permissions.grant(
      'test.plugin',
      ['storage.read'],
      'core',
      'Duplicate grant.'
    );

    expect(first).toEqual(['storage.read', 'storage.write']);
    expect(second).toEqual([]);
    expect(permissions.activeGrants('test.plugin')).toEqual([
      'storage.read',
      'storage.write',
    ]);
    const audit = await permissions.audit('test.plugin');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      event: 'permissions_granted',
      permissions: ['storage.read', 'storage.write'],
      source: 'core',
      createdAt: 123,
    });
    expect(await persistence.loadPermissions()).toHaveLength(2);
  });

  it('rejects unknown permissions on grant', async () => {
    const { permissions } = createHarness();

    await expect(
      permissions.grant(
        'test.plugin',
        ['root.access' as never],
        'user',
        'Invalid.'
      )
    ).rejects.toThrow(/Unknown plugin permission/);
  });

  it('approves only requested permissions and records denials', async () => {
    const { permissions } = createHarness({ now: () => 50 });
    const requested = ['network.access', 'storage.read'] as const;

    const result = await permissions.approve('test.plugin', requested, [
      'storage.read',
    ]);

    expect(result).toEqual({ granted: ['storage.read'], denied: ['network.access'] });
    expect(permissions.has('test.plugin', 'storage.read')).toBe(true);
    expect(permissions.has('test.plugin', 'network.access')).toBe(false);

    const events = (await permissions.audit('test.plugin')).map((entry) => entry.event);
    expect(events).toContain('permissions_denied');
    expect(events).toContain('permissions_granted');

    await expect(
      permissions.approve('test.plugin', requested, ['camera.access'])
    ).rejects.toThrow(/Cannot approve permissions that were not requested/);
  });

  it('revokes individual and all grants without forgetting past consent', async () => {
    const { permissions } = createHarness({ now: () => 70 });

    await permissions.grant(
      'test.plugin',
      ['storage.read', 'storage.write', 'network.access'],
      'user',
      'Setup.'
    );
    await permissions.revoke('test.plugin', 'storage.read', 'No longer needed.');

    expect(permissions.has('test.plugin', 'storage.read')).toBe(false);
    expect(permissions.isRevoked('test.plugin', 'storage.read')).toBe(true);
    expect(permissions.hasEverGranted('test.plugin', 'storage.read')).toBe(true);
    expect(permissions.activeGrants('test.plugin')).toEqual([
      'network.access',
      'storage.write',
    ]);

    await permissions.revokeAll('test.plugin', 'Plugin uninstalled.');
    expect(permissions.activeGrants('test.plugin')).toEqual([]);
    const audit = await permissions.audit('test.plugin');
    expect(audit.map((entry) => entry.event)).toContain('permission_revoked');
    expect(audit.map((entry) => entry.event)).toContain('permissions_revoked_all');
  });

  it('exposes risk metadata and readable summaries', () => {
    expect(isPluginPermission('camera.access')).toBe(true);
    expect(isPluginPermission('eval.code')).toBe(false);
    expect(permissionRisk('camera.access')).toBe('high');
    expect(isSensitivePermission('camera.access')).toBe(true);
    expect(isSensitivePermission('storage.read')).toBe(false);
  });
});
