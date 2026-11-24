import { useCallback, useState } from 'react';

import { usePluginPlatform } from '@/context/plugins';
import { pluginApprovalService } from '@/lib/plugins/approvals';
import {
  MissingPluginPermissionsError,
  PLUGIN_PERMISSION_META,
} from '@/lib/plugins/permissions';
import type { PluginPermission } from '@/lib/plugins/types';

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * Real lifecycle actions for the Plugin Manager. Every permission grant goes
 * through the approval host; nothing is auto-approved by the UI.
 */
export function usePluginActions() {
  const platform = usePluginPlatform();
  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const clear = useCallback(() => {
    setError(null);
    setNotice(null);
  }, []);

  const requestPermissions = useCallback(
    async (
      pluginId: string,
      permissions: PluginPermission[],
      reason: string
    ): Promise<boolean> => {
      const record = platform.registry.getRecord(pluginId);

      if (!record || permissions.length === 0) {
        return permissions.length === 0;
      }

      return pluginApprovalService.requestPermissions({
        pluginId,
        pluginName: record.manifest.name,
        trustLevel: record.trustLevel,
        permissions,
        reason,
      });
    },
    [platform]
  );

  const run = useCallback(
    async (
      pluginId: string,
      label: string,
      task: () => Promise<void>
    ): Promise<boolean> => {
      if (busyPluginId) {
        return false;
      }

      setBusyPluginId(pluginId);
      setError(null);
      setNotice(null);

      try {
        await task();
        return true;
      } catch (actionError) {
        setError(messageOf(actionError, `${label} failed.`));
        return false;
      } finally {
        setBusyPluginId(null);
      }
    },
    [busyPluginId]
  );

  const install = useCallback(
    (pluginId: string) =>
      run(pluginId, 'Install', async () => {
        await platform.registry.install(pluginId);
        setNotice('Plugin installed. Enable it when you are ready.');
      }),
    [platform, run]
  );

  const enable = useCallback(
    (pluginId: string) =>
      run(pluginId, 'Enable', async () => {
        const record = platform.registry.getRecord(pluginId);

        if (!record) {
          throw new Error('Plugin is not registered.');
        }

        const missing = platform.permissions.missing(
          pluginId,
          record.manifest.permissions
        );

        if (missing.length > 0) {
          const approved = await requestPermissions(
            pluginId,
            missing,
            `Enabling ${record.manifest.name} requires ${missing
              .map((permission) => PLUGIN_PERMISSION_META[permission].label)
              .join(', ')}.`
          );

          if (!approved) {
            setNotice('Enable cancelled. No permissions were granted.');
            return;
          }
        }

        try {
          await platform.registry.enable(pluginId, {
            approvePermissions: missing,
          });
        } catch (enableError) {
          if (enableError instanceof MissingPluginPermissionsError) {
            throw new Error(
              `Still missing permission approval for: ${enableError.missing.join(', ')}.`
            );
          }

          throw enableError;
        }

        setNotice('Plugin enabled.');
      }),
    [platform, requestPermissions, run]
  );

  const disable = useCallback(
    (pluginId: string) =>
      run(pluginId, 'Disable', async () => {
        await platform.registry.disable(pluginId);
        setNotice('Plugin disabled. Its contributions were removed.');
      }),
    [platform, run]
  );

  const uninstall = useCallback(
    (pluginId: string, deleteData: boolean) =>
      run(pluginId, 'Uninstall', async () => {
        await platform.registry.uninstall(pluginId, { deleteData });
        setNotice(
          deleteData
            ? 'Plugin uninstalled and its data deleted.'
            : 'Plugin uninstalled. Its settings were retained.'
        );
      }),
    [platform, run]
  );

  const update = useCallback(
    (pluginId: string) =>
      run(pluginId, 'Update', async () => {
        const record = platform.registry.getRecord(pluginId);
        const catalog = platform.registry
          .getCatalogEntries()
          .find((entry) => entry.manifest.pluginId === pluginId);

        if (!record || !catalog) {
          throw new Error('No update is available for this plugin.');
        }

        const added = catalog.manifest.permissions.filter(
          (permission) => !record.manifest.permissions.includes(permission)
        );
        let approved: PluginPermission[] = [];

        if (added.length > 0) {
          const allowed = await requestPermissions(
            pluginId,
            added,
            `Updating to ${catalog.manifest.version} adds ${added
              .map((permission) => PLUGIN_PERMISSION_META[permission].label)
              .join(', ')}.`
          );

          if (!allowed) {
            setNotice('Update cancelled. Permissions were not granted.');
            return;
          }

          approved = added;
        }

        await platform.registry.update(pluginId, catalog.manifest, {
          approveAddedPermissions: approved,
        });
        setNotice(`Plugin updated to ${catalog.manifest.version}.`);
      }),
    [platform, requestPermissions, run]
  );

  const revokePermission = useCallback(
    (pluginId: string, permission: PluginPermission) =>
      run(pluginId, 'Revoke permission', async () => {
        await platform.registry.revokePermission(pluginId, permission);
        setNotice('Permission revoked. The plugin was stopped.');
      }),
    [platform, run]
  );

  const grantPermission = useCallback(
    (pluginId: string, permission: PluginPermission) =>
      run(pluginId, 'Grant permission', async () => {
        const record = platform.registry.getRecord(pluginId);

        if (!record) {
          throw new Error('Plugin is not registered.');
        }

        const approved = await requestPermissions(
          pluginId,
          [permission],
          `Grant ${PLUGIN_PERMISSION_META[permission].label} to ${record.manifest.name}?`
        );

        if (!approved) {
          setNotice('Permission was not granted.');
          return;
        }

        await platform.registry.approvePermissions(
          pluginId,
          [permission],
          'User granted a plugin permission from the Plugin Manager.'
        );
        setNotice('Permission granted.');
      }),
    [platform, requestPermissions, run]
  );

  const syncMcp = useCallback(async () => {
    setError(null);
    setNotice(null);

    try {
      const result = await platform.syncMcpServers(undefined, {
        refreshTools: true,
      });
      setNotice(
        `${result.plugins.connected.length} MCP integration${
          result.plugins.connected.length === 1 ? '' : 's'
        } connected.`
      );
    } catch (syncError) {
      setError(messageOf(syncError, 'Could not sync MCP integrations.'));
    }
  }, [platform]);

  return {
    platform,
    busyPluginId,
    error,
    notice,
    clear,
    install,
    enable,
    disable,
    uninstall,
    update,
    revokePermission,
    grantPermission,
    syncMcp,
    requestPermissions,
  };
}
