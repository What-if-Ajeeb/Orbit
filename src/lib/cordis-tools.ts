import type { SQLiteDatabase } from 'expo-sqlite';

import type { AgentTool, AgentToolContext, ToolExecution } from './ai/tool-registry';
import { getPluginPlatform } from './plugins/platform';
import { PLUGIN_PERMISSION_META } from './plugins/permissions';

type ToolParamSchema = Record<
  string,
  { type: string; description?: string; [key: string]: unknown }
>;

function cordisTool(
  name: string,
  description: string,
  parameters: ToolParamSchema,
  execute: (
    ctx: AgentToolContext,
    args: Record<string, unknown>
  ) => Promise<ToolExecution>
): AgentTool {
  return {
    meta: { source: 'builtin' },
    definition: {
      name,
      description,
      parameters: { type: 'object', properties: parameters, required: [] },
    },
    execute,
  };
}

function platformUnavailable(): ToolExecution {
  return {
    content: JSON.stringify({
      ok: false,
      error: 'The plugin platform is still starting. Try again in a moment.',
    }),
    trace: 'plugin platform unavailable',
  };
}

/**
 * Read-only creator-mode introspection tools.
 *
 * ORBIT 2.0 deliberately removed every tool that accepted executable source
 * code (`cordis_plugin_write`, `cordis_plugin_mount`, overlay registration).
 * Plugin installation, permission approval and enabling are user actions in
 * the Plugin Manager; the agent can inspect the registry but cannot execute
 * downloaded code or grant permissions.
 */
export function buildCordisTools(_db: SQLiteDatabase): AgentTool[] {
  const listPlugins = cordisTool(
    'cordis_plugin_list',
    'List installed and available ORBIT plugins with their lifecycle state. Read-only.',
    {
      status: {
        type: 'string',
        description: 'Optional status filter, e.g. running or available.',
      },
    },
    async (_context, args) => {
      const platform = getPluginPlatform();

      if (!platform) {
        return platformUnavailable();
      }

      const status = args.status ? String(args.status) : null;
      const summaries = platform.registry
        .getSummaries()
        .filter((summary) => !status || summary.status === status)
        .map((summary) => ({
          pluginId: summary.manifest.pluginId,
          name: summary.manifest.name,
          version: summary.manifest.version,
          status: summary.status,
          enabled: summary.enabled,
          trustLevel: summary.trustLevel,
          source: summary.source,
          legacy: summary.legacy,
          requestedPermissions: summary.manifest.permissions,
          missingPermissions: summary.missingPermissions,
          hasUpdate: summary.hasUpdate,
          error: summary.error,
        }));

      return {
        content: JSON.stringify({ ok: true, plugins: summaries }),
        trace: `cordis_plugin_list: ${summaries.length} plugins`,
      };
    }
  );

  const inspectPlugin = cordisTool(
    'cordis_plugin_inspect',
    'Inspect one plugin manifest, lifecycle state, permissions and recent history. Read-only.',
    {
      pluginId: { type: 'string', description: 'Plugin id to inspect' },
    },
    async (_context, args) => {
      const platform = getPluginPlatform();

      if (!platform) {
        return platformUnavailable();
      }

      const pluginId = String(args.pluginId ?? '');
      const record = platform.registry.getRecord(pluginId);

      if (!record) {
        return {
          content: JSON.stringify({ ok: false, error: `Unknown plugin: ${pluginId}` }),
          trace: `cordis_plugin_inspect: ${pluginId} not found`,
        };
      }

      const [history, audit] = await Promise.all([
        platform.registry.installHistory(pluginId, 10),
        platform.registry.permissionAudit(pluginId, 10),
      ]);

      return {
        content: JSON.stringify({
          ok: true,
          manifest: record.manifest,
          status: record.status,
          enabled: record.enabled,
          trustLevel: record.trustLevel,
          source: record.source,
          grantedPermissions: platform.permissions.activeGrants(pluginId),
          missingPermissions: platform.permissions.missing(
            pluginId,
            record.manifest.permissions
          ),
          permissions: record.manifest.permissions.map((permission) => ({
            ...PLUGIN_PERMISSION_META[permission],
          })),
          health: record.health,
          error: record.error,
          history,
          audit,
        }),
        trace: `cordis_plugin_inspect: ${pluginId} (${record.status})`,
      };
    }
  );

  const permissionAudit = cordisTool(
    'cordis_plugin_permission_audit',
    'Read recent plugin permission decisions. Read-only.',
    {
      pluginId: {
        type: 'string',
        description: 'Optional plugin id; omit for the global audit trail.',
      },
      limit: {
        type: 'number',
        description: 'Maximum records (default 25, max 100)',
      },
    },
    async (_context, args) => {
      const platform = getPluginPlatform();

      if (!platform) {
        return platformUnavailable();
      }

      const pluginId = args.pluginId ? String(args.pluginId) : undefined;
      const requested = Number(args.limit ?? 25);
      const limit = Number.isFinite(requested)
        ? Math.min(Math.max(Math.trunc(requested), 1), 100)
        : 25;
      const audit = await platform.registry.permissionAudit(pluginId, limit);

      return {
        content: JSON.stringify({ ok: true, audit }),
        trace: `cordis_plugin_permission_audit: ${audit.length} records`,
      };
    }
  );

  return [listPlugins, inspectPlugin, permissionAudit];
}
