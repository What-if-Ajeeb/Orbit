import type { SandboxProgramManifest } from '@/lib/sandbox/types';

import type { PluginRegistry } from './registry';
import type {
  PluginImplementation,
  PluginManifest,
  PluginPlatform,
} from './types';

type ManifestSeed = Partial<PluginManifest> &
  Pick<
    PluginManifest,
    | 'pluginId'
    | 'name'
    | 'version'
    | 'description'
    | 'category'
    | 'minimumOrbitVersion'
    | 'platformSupport'
    | 'entryPoint'
  >;

function seed(input: ManifestSeed): PluginManifest {
  return {
    manifestVersion: 1,
    author: { name: 'ORBIT' },
    publisher: {
      id: 'orbit',
      name: 'ORBIT',
      verified: true,
    },
    icon: 'extension-puzzle-outline',
    permissions: [],
    capabilities: [],
    dependencies: [],
    optionalDependencies: [],
    routes: [],
    navigationEntries: [],
    dashboardWidgets: [],
    settingsSections: [],
    settingsSchema: [],
    toolbarActions: [],
    contextActions: [],
    mcpTools: [],
    events: { emits: [], listens: [] },
    lifecycleHooks: [],
    dataSchemaVersion: 1,
    updatePolicy: 'manual',
    ...input,
  };
}

const ALL_PLATFORMS: PluginPlatform[] = ['android', 'ios', 'web'];

/**
 * The five Cordis spine plugins remain the core of ORBIT. These manifests are
 * metadata for the unified registry; the actual Cordis mount stays in
 * `harness/spine/context.ts` and is never mounted twice.
 */
export const CORE_PLUGIN_MANIFESTS: PluginManifest[] = [
  seed({
    pluginId: 'orbit.core.session',
    name: 'Orbit Session',
    version: '1.0.0',
    description:
      'Cordis session service. Persists conversations and emits session events through the existing chat store.',
    category: 'service',
    icon: 'chatbubbles-outline',
    minimumOrbitVersion: '1.0.0',
    platformSupport: ALL_PLATFORMS,
    entryPoint: { kind: 'builtin', moduleId: 'orbit-session' },
    capabilities: ['storage.namespaced', 'events.publish'],
    events: { emits: ['session/created', 'session/deleted'], listens: [] },
    dataSchemaVersion: 1,
  }),
  seed({
    pluginId: 'orbit.core.tools',
    name: 'Orbit Tools',
    version: '1.0.0',
    description:
      'Cordis tool service. Exposes the reviewed built-in agent tool registry.',
    category: 'tool',
    icon: 'construct-outline',
    minimumOrbitVersion: '1.0.0',
    platformSupport: ALL_PLATFORMS,
    entryPoint: { kind: 'builtin', moduleId: 'orbit-tools' },
    capabilities: ['tools.ai', 'events.publish'],
    events: { emits: ['orbit/tools/register', 'orbit/tools/unregister'], listens: [] },
    dataSchemaVersion: 1,
  }),
  seed({
    pluginId: 'orbit.core.llm',
    name: 'Orbit LLM',
    version: '1.0.0',
    description:
      'Cordis LLM adapter registry. Hosts the OpenAI-compatible, Gemini and Ollama adapters.',
    category: 'provider',
    icon: 'sparkles-outline',
    minimumOrbitVersion: '1.0.0',
    platformSupport: ALL_PLATFORMS,
    entryPoint: { kind: 'builtin', moduleId: 'orbit-llm' },
    capabilities: ['provider.llm'],
    dataSchemaVersion: 1,
  }),
  seed({
    pluginId: 'orbit.core.mcp',
    name: 'Orbit MCP',
    version: '1.0.0',
    description:
      'Cordis MCP integration service. Syncs configured server tools into the tool registry.',
    category: 'integration',
    icon: 'extension-puzzle-outline',
    minimumOrbitVersion: '1.0.0',
    platformSupport: ALL_PLATFORMS,
    entryPoint: { kind: 'builtin', moduleId: 'orbit-mcp' },
    dependencies: [{ pluginId: 'orbit.core.tools', version: '^1.0.0' }],
    capabilities: ['integration.mcp', 'tools.mcp'],
    dataSchemaVersion: 1,
  }),
  seed({
    pluginId: 'orbit.core.agent',
    name: 'Orbit Agent',
    version: '1.0.0',
    description:
      'Cordis agent marker service. Keeps the existing agent loop connected to the spine.',
    category: 'ai',
    icon: 'terminal-outline',
    minimumOrbitVersion: '1.0.0',
    platformSupport: ALL_PLATFORMS,
    entryPoint: { kind: 'builtin', moduleId: 'orbit-agent' },
    dependencies: [
      { pluginId: 'orbit.core.session', version: '^1.0.0' },
      { pluginId: 'orbit.core.tools', version: '^1.0.0' },
      { pluginId: 'orbit.core.llm', version: '^1.0.0' },
    ],
    capabilities: ['ai.context', 'tools.ai'],
    dataSchemaVersion: 1,
  }),
];

export const CORE_PLUGIN_IDS = CORE_PLUGIN_MANIFESTS.map(
  (manifest) => manifest.pluginId
);

export const DIAGNOSTICS_PLUGIN_ID = 'orbit.builtin.diagnostics';

export const DIAGNOSTICS_MANIFEST: PluginManifest = seed({
  pluginId: DIAGNOSTICS_PLUGIN_ID,
  name: 'Plugin Diagnostics',
  version: '1.0.0',
  description:
    'A small built-in plugin that watches plugin errors and contributes a dashboard widget and settings section.',
  category: 'service',
  icon: 'pulse-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ALL_PLATFORMS,
  entryPoint: { kind: 'builtin', moduleId: 'orbit-diagnostics' },
  permissions: ['ui.contribute', 'ai.invoke'],
  capabilities: ['ui.widgets', 'ui.settings', 'events.subscribe', 'tools.ai'],
  routes: [{ id: 'home', screen: 'plugin-home', title: 'Plugin Diagnostics' }],
  dashboardWidgets: [
    {
      id: 'plugin-health',
      title: 'Plugin platform',
      description: 'Running plugins, failures and update availability.',
      size: 'medium',
    },
  ],
  settingsSections: [
    {
      id: 'plugin-diagnostics',
      title: 'Plugin diagnostics',
      description: 'Health, install history and permission audit for every plugin.',
    },
  ],
  settingsSchema: [],
  events: { emits: [], listens: ['plugin.error'] },
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
  updatePolicy: 'manual',
});

/** Data-only program executed in the isolated process, never as JavaScript. */
const DIAGNOSTICS_ECHO_PROGRAM: SandboxProgramManifest = {
  pluginId: DIAGNOSTICS_PLUGIN_ID,
  version: DIAGNOSTICS_MANIFEST.version,
  program: {
    version: 1,
    instructions: [
      { op: 'load', key: 'input', field: 'value' },
      { op: 'emit', key: 'content' },
      { op: 'return' },
    ],
  },
};

const diagnosticsImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.diagnostics] diagnostics plugin started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.diagnostics] diagnostics plugin stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.diagnostics] a plugin reported an error');
    },
  },
  activate(sdk) {
    sdk.events.subscribe('plugin.error', (event) => {
      sdk.logger.warn('Plugin error observed.', event.payload);
    });

    void sdk.tools.register({
      name: 'sandbox_echo',
      description: 'Echo a short value through the isolated Android sandbox.',
      parameters: {
        type: 'object',
        properties: { value: { type: 'string' } },
        required: ['value'],
        additionalProperties: false,
      },
      program: DIAGNOSTICS_ECHO_PROGRAM,
    });
  },
};

export const BUILTIN_IMPLEMENTATIONS: Record<string, PluginImplementation> = {
  'orbit-diagnostics': diagnosticsImplementation,
};

/**
 * Registers reviewed native implementations by plugin id. This is the only path
 * that attaches executable code; declarative and untrusted plugins cannot use
 * it.
 */
export function registerBuiltinImplementations(registry: PluginRegistry): void {
  for (const manifest of [...CORE_PLUGIN_MANIFESTS, DIAGNOSTICS_MANIFEST]) {
    if (manifest.entryPoint.kind !== 'builtin') {
      continue;
    }

    const implementation = BUILTIN_IMPLEMENTATIONS[manifest.entryPoint.moduleId];

    if (implementation) {
      registry.registerImplementation(manifest.pluginId, implementation);
    }
  }
}
