import { agentToolRegistry } from '@/lib/ai/tool-registry';

import { seedPluginManifest } from '../manifest-seed';
import type {
  PluginImplementation,
  PluginManifest,
} from '../types';
import {
  nativeHostTool,
  nativeOutputSchema,
  objectSchema,
  readString,
} from './helpers';

export const AGENT_PLUGIN_ID = 'orbit.builtin.agent';

export const agentManifest: PluginManifest = seedPluginManifest({
  pluginId: AGENT_PLUGIN_ID,
  name: 'ORBIT Agent',
  version: '1.0.0',
  description:
    'Read-only introspection for the existing ORBIT agent loop, tool registry and agent capabilities. It never starts a second agent runtime.',
  category: 'ai',
  icon: 'terminal-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ['android', 'ios', 'web'],
  entryPoint: { kind: 'builtin', moduleId: 'orbit-native-agent' },
  permissions: ['ai.invoke'],
  capabilities: ['ai.context', 'tools.ai'],
  dependencies: [
    { pluginId: 'orbit.core.session', version: '^1.0.0' },
    { pluginId: 'orbit.core.tools', version: '^1.0.0' },
    { pluginId: 'orbit.core.llm', version: '^1.0.0' },
  ],
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
});

const STATUS_OUTPUT_SCHEMA = nativeOutputSchema({
  toolCount: { type: 'integer' },
  pluginToolCount: { type: 'integer' },
  mcpToolCount: { type: 'integer' },
  connectionToolCount: { type: 'integer' },
  builtinToolCount: { type: 'integer' },
});

const LIST_OUTPUT_SCHEMA = nativeOutputSchema({
  total: { type: 'integer' },
  tools: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        source: { type: 'string' },
      },
      required: ['name', 'description', 'source'],
      additionalProperties: false,
    },
  },
});

const statusTool = nativeHostTool('agent_status', {
  name: 'agent_status',
  description:
    'Report how many tools are available in the existing ORBIT agent registry, grouped by source.',
  parameters: objectSchema({}, []),
  outputSchema: STATUS_OUTPUT_SCHEMA,
  execute() {
    const descriptors = agentToolRegistry.descriptors();
    const source = (metaSource: string | undefined): string => metaSource ?? 'builtin';
    const count = (wanted: string): number =>
      descriptors.filter((entry) => source(entry.meta?.source) === wanted).length;

    return {
      toolCount: descriptors.length,
      pluginToolCount: count('plugin'),
      mcpToolCount: count('mcp'),
      connectionToolCount: count('connection'),
      builtinToolCount: count('builtin'),
    };
  },
});

const listToolsTool = nativeHostTool('agent_list_tools', {
  name: 'agent_list_tools',
  description:
    'List tools currently visible to the ORBIT agent, optionally filtered by source.',
  parameters: objectSchema(
    {
      source: {
        type: 'string',
        enum: ['builtin', 'plugin', 'mcp', 'connection'],
      },
      limit: { type: 'integer', minimum: 1, maximum: 50 },
    },
    []
  ),
  outputSchema: LIST_OUTPUT_SCHEMA,
  execute(args) {
    const source = readString(args, 'source');
    const limit = args.limit === undefined ? 20 : Number(args.limit);

    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('limit must be an integer between 1 and 50.');
    }

    const descriptors = agentToolRegistry
      .descriptors()
      .filter((entry) =>
        source ? (entry.meta?.source ?? 'builtin') === source : true
      )
      .slice(0, limit)
      .map((entry) => ({
        name: entry.definition.name,
        description: entry.definition.description.slice(0, 240),
        source: entry.meta?.source ?? 'builtin',
      }));

    return { total: descriptors.length, tools: descriptors };
  },
});

export const agentImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.agent] agent introspection started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.agent] agent introspection stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.agent] agent introspection reported an error');
    },
  },
  activate(sdk) {
    void sdk.tools.register(statusTool);
    void sdk.tools.register(listToolsTool);
  },
};
