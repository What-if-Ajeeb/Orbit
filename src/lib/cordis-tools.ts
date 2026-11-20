import type { SQLiteDatabase } from 'expo-sqlite';
import type { AgentTool, AgentToolContext, ToolExecution } from './ai/tool-registry';
import type { LlmToolDefinition } from './ai/types';
import { agentToolRegistry } from './ai/tool-registry';
import { PluginStore } from './plugin-store';
import { pluginRuntime } from './plugin-runtime';

type ToolParamSchema = Record<string, { type: string; description?: string; [key: string]: unknown }>;

function cordisTool(
  name: string,
  description: string,
  parameters: ToolParamSchema,
  execute: (ctx: AgentToolContext, args: Record<string, unknown>) => Promise<ToolExecution>
): AgentTool {
  return {
    definition: {
      name,
      description,
      parameters: { type: 'object', properties: parameters, required: [] },
    },
    execute,
  };
}

function loadPluginFromCode(code: string): AgentTool | null {
  try {
    const module = { exports: {} };
    // Creator mode is opt-in; plugin code runs on-device with user consent.
    new Function('module', 'exports', code)(module, module.exports);
    const def = module.exports as {
      definition: LlmToolDefinition;
      execute: (...args: any[]) => Promise<ToolExecution>;
    };
    if (!def || !def.definition || !def.execute) {
      return null;
    }
    return {
      definition: def.definition,
      execute: def.execute,
    };
  } catch {
    return null;
  }
}

export function buildCordisTools(db: SQLiteDatabase): AgentTool[] {
  const store = new PluginStore(db);

  const writePlugin = cordisTool(
    'cordis_plugin_write',
    'Write a new plugin to disk. Creator mode only.',
    {
      name: { type: 'string', description: 'Plugin name' },
      type: {
        type: 'string',
        description: "Plugin type: 'tool', 'overlay', 'provider', or 'storage'",
      },
      code: { type: 'string', description: 'Plugin source code (CommonJS module.exports)' },
      config: {
        type: 'object',
        description: 'Optional plugin config',
        properties: {},
        additionalProperties: true,
      },
    },
    async ({ db, userId }, args) => {
      const name = String(args.name ?? '');
      const type = String(args.type ?? 'tool');
      const code = String(args.code ?? '');
      const config = args.config as Record<string, unknown> | undefined;

      if (!name || !code) {
        return {
          content: JSON.stringify({ ok: false, error: 'name and code are required' }),
          trace: 'cordis_plugin_write: missing name or code',
        };
      }

      if (!['tool', 'overlay', 'provider', 'storage'].includes(type)) {
        return {
          content: JSON.stringify({ ok: false, error: 'invalid plugin type' }),
          trace: 'cordis_plugin_write: invalid type',
        };
      }

      const pluginType = (type as unknown) as ('tool' | 'overlay' | 'provider' | 'storage');
      const plugin = await store.createPlugin({
        name,
        type: pluginType,
        code,
        config,
      });

      return {
        content: JSON.stringify({
          ok: true,
          id: plugin.id,
          name: plugin.name,
          type: plugin.type,
        }),
        trace: `cordis_plugin_write: created plugin #${plugin.id}`,
      };
    },
  );

  const listPlugins = cordisTool(
    'cordis_plugin_list',
    'List all installed plugins. Creator mode only.',
    {},
    async ({ db }) => {
      const plugins = await store.listPlugins();
      return {
        content: JSON.stringify(
          plugins.map((p) => ({
            id: p.id,
            name: p.name,
            type: p.type,
            enabled: p.enabled,
            createdAt: p.createdAt,
          }))
        ),
        trace: `cordis_plugin_list: ${plugins.length} plugins`,
      };
    },
  );

  const mountPlugin = cordisTool(
    'cordis_plugin_mount',
    'Mount an installed plugin so the agent can use it. Creator mode only.',
    {
      id: { type: 'number', description: 'Plugin id to mount' },
    },
    async ({ db, userId }, args) => {
      const id = Number(args.id);
      const plugin = await store.getPlugin(id);

      if (!plugin) {
        return {
          content: JSON.stringify({ ok: false, error: `plugin #${id} not found` }),
          trace: `cordis_plugin_mount: plugin #${id} not found`,
        };
      }

      if (plugin.type !== 'tool') {
        return {
          content: JSON.stringify({
            ok: false,
            error: `plugin #${id} is type '${plugin.type}', not a tool`,
          }),
          trace: `cordis_plugin_mount: plugin #${id} wrong type`,
        };
      }

      const tool = loadPluginFromCode(plugin.code);
      if (!tool) {
        return {
          content: JSON.stringify({
            ok: false,
            error: `could not load plugin #${id} code`,
          }),
          trace: `cordis_plugin_mount: plugin #${id} load failed`,
        };
      }

      agentToolRegistry.register(tool, { replace: true });
      pluginRuntime.mountPlugin(plugin, tool);

      return {
        content: JSON.stringify({
          ok: true,
          id: plugin.id,
          name: plugin.name,
          toolName: tool.definition.name,
        }),
        trace: `cordis_plugin_mount: mounted #${plugin.id} (${tool.definition.name})`,
      };
    },
  );

  const unmountPlugin = cordisTool(
    'cordis_plugin_unmount',
    'Unmount a mounted plugin. Creator mode only.',
    {
      id: { type: 'number', description: 'Plugin id to unmount' },
    },
    async ({ db }, args) => {
      const id = Number(args.id);
      const mounted = pluginRuntime.getPlugin(id);
      if (!mounted) {
        return {
          content: JSON.stringify({ ok: false, error: `plugin #${id} not mounted` }),
          trace: `cordis_plugin_unmount: #${id} not mounted`,
        };
      }
      agentToolRegistry.unregister(mounted.tool!.definition.name);
      pluginRuntime.unmountPlugin(id);
      await store.setPluginEnabled(id, false);
      return {
        content: JSON.stringify({ ok: true, id }),
        trace: `cordis_plugin_unmount: #${id}`,
      };
    },
  );

  const deletePlugin = cordisTool(
    'cordis_plugin_delete',
    'Delete an installed plugin. Creator mode only.',
    {
      id: { type: 'number', description: 'Plugin id to delete' },
    },
    async ({ db }, args) => {
      const id = Number(args.id);
      const mounted = pluginRuntime.getPlugin(id);
      if (mounted) {
        agentToolRegistry.unregister(mounted.tool!.definition.name);
        pluginRuntime.unmountPlugin(id);
      }
      await store.deletePlugin(id);
      return {
        content: JSON.stringify({ ok: true, id }),
        trace: `cordis_plugin_delete: #${id}`,
      };
    },
  );

  const registerOverlay = cordisTool(
    'cordis_ui_overlay_register',
    'Register a UI overlay in a screen slot. Creator mode only.',
    {
      slot: { type: 'string', description: 'Overlay slot (e.g. chat_footer, settings_sidebar)' },
      name: { type: 'string', description: 'Overlay name' },
      code: { type: 'string', description: 'Overlay component code' },
    },
    async ({ db, userId }, args) => {
      const slot = String(args.slot ?? '');
      const name = String(args.name ?? '');
      const code = String(args.code ?? '');

      if (!slot || !name || !code) {
        return {
          content: JSON.stringify({ ok: false, error: 'slot, name, and code are required' }),
          trace: 'cordis_ui_overlay_register: missing fields',
        };
      }

      const overlay = await store.createOverlay({
        slot,
        name,
        code,
      });

      pluginRuntime.registerOverlay(slot, overlay);

      return {
        content: JSON.stringify({
          ok: true,
          id: overlay.id,
          slot: overlay.slot,
          name: overlay.name,
        }),
        trace: `cordis_ui_overlay_register: ${slot}/${overlay.name}`,
      };
    },
  );

  const listOverlays = cordisTool(
    'cordis_ui_overlay_list',
    'List UI overlays. Creator mode only.',
    {
      slot: { type: 'string', description: 'Optional slot filter' },
    },
    async ({ db }, args) => {
      const slot = args.slot ? String(args.slot) : undefined;
      const overlays = slot ? await store.listOverlays(slot) : await store.listOverlays();
      return {
        content: JSON.stringify(
          overlays.map((o) => ({
            id: o.id,
            slot: o.slot,
            name: o.name,
            enabled: o.enabled,
          }))
        ),
        trace: `cordis_ui_overlay_list: ${overlays.length} overlays`,
      };
    },
  );

  return [writePlugin, listPlugins, mountPlugin, unmountPlugin, deletePlugin, registerOverlay, listOverlays];
}
