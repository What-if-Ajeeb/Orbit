import {
  MEMORY_MAX,
  loadAgentConfig,
  saveAgentConfig,
} from '@/lib/agent-settings';
import { redactSecrets } from '@/lib/permissions/redact';

import { seedPluginManifest } from '../manifest-seed';
import type {
  PluginImplementation,
  PluginManifest,
} from '../types';
import {
  nativeOutputSchema,
  nativeTool,
  objectSchema,
  readString,
} from './helpers';

export const MEMORY_PLUGIN_ID = 'orbit.builtin.memory';

const DEFAULT_AGENT_ID = 'master';

export const memoryManifest: PluginManifest = seedPluginManifest({
  pluginId: MEMORY_PLUGIN_ID,
  name: 'ORBIT Memory',
  version: '1.0.0',
  description:
    'Reads and writes per-agent memory in the existing agent_configs table. Memory stays local to the user and agent and is injected into prompts by the existing prompt builder.',
  category: 'service',
  icon: 'brain-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ['android', 'ios', 'web'],
  entryPoint: { kind: 'builtin', moduleId: 'orbit-native-memory' },
  permissions: ['ai.invoke', 'storage.read', 'storage.write'],
  capabilities: ['storage.namespaced', 'ai.context'],
  dependencies: [{ pluginId: 'orbit.core.agent', version: '^1.0.0' }],
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
});

const MEMORY_OUTPUT_SCHEMA = nativeOutputSchema({
  agentId: { type: 'string' },
  memory: { type: 'string' },
  updatedAt: { type: 'integer' },
  truncated: { type: 'boolean' },
});

function agentIdArg(args: Record<string, unknown>): string {
  return readString(args, 'agentId', { maxLength: 80 }) ?? DEFAULT_AGENT_ID;
}

const readMemoryTool = nativeTool('memory_read', {
  name: 'memory_read',
  description:
    'Read the saved memory for an agent. Returns an empty string when no memory has been saved.',
  parameters: objectSchema({ agentId: { type: 'string' } }, []),
  outputSchema: MEMORY_OUTPUT_SCHEMA,
  async execute(args, context) {
    const agentId = agentIdArg(args);
    const config = await loadAgentConfig(context.db, context.userId, agentId);

    return {
      agentId,
      memory: config.memory,
      updatedAt: config.updatedAt,
      truncated: false,
    };
  },
});

const writeMemoryTool = nativeTool('memory_write', {
  name: 'memory_write',
  description:
    'Replace the saved memory for an agent. Use only for durable preferences, never secrets or credentials.',
  parameters: objectSchema(
    {
      agentId: { type: 'string' },
      memory: { type: 'string' },
    },
    ['memory']
  ),
  outputSchema: MEMORY_OUTPUT_SCHEMA,
  requiresApproval: true,
  async execute(args, context) {
    const agentId = agentIdArg(args);
    const memory = readString(args, 'memory', { required: true }) ?? '';

    if (redactSecrets(memory) !== memory) {
      throw new Error('Memory must not contain secrets or credentials.');
    }

    const originalLength = memory.length;
    const config = await saveAgentConfig(context.db, context.userId, agentId, {
      memory,
    });

    return {
      agentId,
      memory: config.memory,
      updatedAt: config.updatedAt,
      truncated: config.memory.length < originalLength,
    };
  },
});

export const memoryImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.memory] memory plugin started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.memory] memory plugin stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.memory] memory plugin reported an error');
    },
  },
  activate(sdk) {
    void sdk.tools.register(readMemoryTool);
    void sdk.tools.register(writeMemoryTool);
    sdk.logger.info(`Memory limit is ${MEMORY_MAX} characters.`);
  },
};
