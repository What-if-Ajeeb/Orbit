import { describe, expect, it } from 'vitest';

import { PluginSettingError } from '../registry';
import {
  isSecretSettingKey,
  PluginKeyValueStorage,
  PluginStorageError,
  PluginStorageQuotaError,
  validateSettingValue,
  withSettingDefaults,
} from '../storage';
import { utf8ByteLength } from '../persistence';
import { createHarness, makeManifest } from './helpers';

describe('plugin key/value storage', () => {
  it('isolates values by plugin namespace', async () => {
    const { persistence } = createHarness();
    const storage = new PluginKeyValueStorage(persistence, undefined, () => 500);

    await storage.set('plugin.a', 'theme', 'dark');
    await storage.set('plugin.b', 'theme', 'light');

    expect(await storage.get('plugin.a', 'theme')).toBe('dark');
    expect(await storage.get('plugin.b', 'theme')).toBe('light');
    expect((await storage.list('plugin.a')).map((entry) => entry.key)).toEqual(['theme']);
    expect((await storage.list('plugin.a'))[0]).toMatchObject({ bytes: 6, updatedAt: 500 });

    await storage.clear('plugin.a');
    expect(await storage.get('plugin.a', 'theme')).toBeNull();
    expect(await storage.get('plugin.b', 'theme')).toBe('light');
  });

  it('enforces quota using UTF-8 bytes and credits overwritten keys', async () => {
    const { persistence } = createHarness();
    const storage = new PluginKeyValueStorage(persistence, 12, () => 1);

    await storage.set('plugin.a', 'first', 'abc'); // "\"abc\"" = 5 bytes
    await storage.set('plugin.a', 'second', 'abc'); // 5 more bytes

    expect(await storage.usage('plugin.a')).toEqual({ bytes: 10, limit: 12 });
    await expect(storage.set('plugin.a', 'first', 'abcdefgh')).rejects.toThrow(
      PluginStorageQuotaError
    );

    await storage.set('plugin.a', 'first', 'a'); // 3 bytes, replaces 5
    expect(await storage.usage('plugin.a')).toEqual({ bytes: 8, limit: 12 });

    const unicode = new PluginKeyValueStorage(persistence, 5, () => 1);
    await unicode.set('plugin.b', 'k', 'é'); // "\"é\"" = 4 bytes
    await expect(unicode.set('plugin.b', 'k', 'éé')).rejects.toThrow(
      PluginStorageQuotaError
    );
    expect(utf8ByteLength('"é"')).toBe(4);
  });

  it('rejects invalid keys and unreadable stored values', async () => {
    const { persistence } = createHarness();
    const storage = new PluginKeyValueStorage(persistence);

    for (const key of ['', 'has space', '-leading', 'a/b', 'x'.repeat(129)]) {
      await expect(storage.get('plugin.a', key)).rejects.toThrow(PluginStorageError);
      await expect(storage.set('plugin.a', key, 1)).rejects.toThrow(PluginStorageError);
      await expect(storage.delete('plugin.a', key)).rejects.toThrow(PluginStorageError);
    }

    await storage.set('plugin.a', 'valid.key-1:ok', { nested: true });
    expect(await storage.get('plugin.a', 'valid.key-1:ok')).toEqual({ nested: true });

    await persistence.setKv({
      pluginId: 'plugin.a',
      key: 'broken',
      value: '{not json',
      updatedAt: 1,
      bytes: 8,
    });
    await expect(storage.get('plugin.a', 'broken')).rejects.toThrow(/not valid JSON/);
  });
});

describe('plugin settings values', () => {
  it('validates declared types, ranges and select options', () => {
    expect(
      validateSettingValue(
        { key: 'name', type: 'string', label: 'Name', required: true },
        '   '
      )
    ).toMatchObject({ ok: false });
    expect(
      validateSettingValue({ key: 'name', type: 'string', label: 'Name' }, 'ok')
    ).toEqual({ ok: true, value: 'ok' });
    expect(
      validateSettingValue(
        { key: 'count', type: 'number', label: 'Count', minimum: 1, maximum: 3 },
        4
      )
    ).toMatchObject({ ok: false });
    expect(
      validateSettingValue(
        { key: 'enabled', type: 'boolean', label: 'Enabled' },
        true
      )
    ).toEqual({ ok: true, value: true });
    expect(
      validateSettingValue(
        {
          key: 'mode',
          type: 'select',
          label: 'Mode',
          options: [{ value: 'fast', label: 'Fast' }],
        },
        'slow'
      )
    ).toMatchObject({ ok: false });
  });

  it('applies defaults without overwriting stored values', () => {
    expect(
      withSettingDefaults(
        [
          { key: 'mode', type: 'string', label: 'Mode', default: 'fast' },
          { key: 'count', type: 'number', label: 'Count', default: 3 },
        ],
        { mode: 'slow' }
      )
    ).toEqual({ mode: 'slow', count: 3 });
  });

  it('rejects secret-looking and undeclared settings through the registry', async () => {
    const { registry } = createHarness();
    registry.discover(
      makeManifest({
        permissions: ['storage.write'],
        settingsSchema: [
          { key: 'mode', type: 'string', label: 'Mode', default: 'fast' },
          {
            key: 'count',
            type: 'number',
            label: 'Count',
            minimum: 1,
            maximum: 3,
            default: 2,
          },
        ],
      }),
      { trustLevel: 'local', source: 'local' }
    );
    await registry.install('test.plugin', { approvePermissions: ['storage.write'] });

    expect(isSecretSettingKey('apiKey')).toBe(true);
    expect(await registry.getSettings('test.plugin')).toEqual({ mode: 'fast', count: 2 });
    await registry.setSetting('test.plugin', 'mode', 'slow');
    expect(await registry.getSettings('test.plugin')).toMatchObject({ mode: 'slow' });

    await expect(
      registry.setSetting('test.plugin', 'apiKey', 'secret')
    ).rejects.toThrow(PluginSettingError);
    await expect(
      registry.setSetting('test.plugin', 'missing', 'x')
    ).rejects.toThrow(/does not declare the setting/);
    await expect(
      registry.setSetting('test.plugin', 'count', 9)
    ).rejects.toThrow(PluginSettingError);

    await registry.deleteSetting('test.plugin', 'mode');
    expect(await registry.getSettings('test.plugin')).toMatchObject({ mode: 'fast' });
  });
});
