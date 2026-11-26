import type { PluginRegistry } from '../registry';
import type { PluginImplementation, PluginManifest } from '../types';

import {
  AGENT_PLUGIN_ID,
  agentImplementation,
  agentManifest,
} from './agent';
import {
  BUDDY_PLUGIN_ID,
  buddyImplementation,
  buddyManifest,
} from './buddy';
import {
  BROWSER_PLUGIN_ID,
  browserImplementation,
  browserManifest,
} from './browser';
import {
  CODE_PLUGIN_ID,
  codeImplementation,
  codeManifest,
} from './code';
import {
  PROJECTS_PLUGIN_ID,
  projectsImplementation,
  projectsManifest,
} from './projects';
import {
  TASKS_PLUGIN_ID,
  tasksImplementation,
  tasksManifest,
} from './tasks';
import {
  FILES_PLUGIN_ID,
  filesImplementation,
  filesManifest,
} from './files';
import {
  MCP_PLUGIN_ID,
  mcpImplementation,
  mcpManifest,
} from './mcp';
import {
  MEMORY_PLUGIN_ID,
  memoryImplementation,
  memoryManifest,
} from './memory';
import {
  SANDBOX_PLUGIN_ID,
  sandboxImplementation,
  sandboxManifest,
} from './sandbox';

export type NativePluginDefinition = {
  manifest: PluginManifest;
  implementation: PluginImplementation;
};

/**
 * Reviewed native plugins bundled with ORBIT. Each entry pairs a canonical v1
 * manifest with host-reviewed code; no manifest here can supply its own code.
 */
export const NATIVE_PLUGIN_DEFINITIONS: NativePluginDefinition[] = [
  { manifest: agentManifest, implementation: agentImplementation },
  { manifest: memoryManifest, implementation: memoryImplementation },
  { manifest: filesManifest, implementation: filesImplementation },
  { manifest: browserManifest, implementation: browserImplementation },
  { manifest: codeManifest, implementation: codeImplementation },
  { manifest: tasksManifest, implementation: tasksImplementation },
  { manifest: projectsManifest, implementation: projectsImplementation },
  { manifest: buddyManifest, implementation: buddyImplementation },
  { manifest: mcpManifest, implementation: mcpImplementation },
  { manifest: sandboxManifest, implementation: sandboxImplementation },
];

export const NATIVE_PLUGIN_MANIFESTS: PluginManifest[] =
  NATIVE_PLUGIN_DEFINITIONS.map((entry) => entry.manifest);

export const NATIVE_PLUGIN_IDS: string[] = NATIVE_PLUGIN_DEFINITIONS.map(
  (entry) => entry.manifest.pluginId
);

export const NATIVE_PLUGIN_READMES: Record<string, string> = {
  [AGENT_PLUGIN_ID]:
    'Read-only introspection of the existing ORBIT agent loop and tool registry. It adds no second runtime and cannot change agent settings or permissions.',
  [MEMORY_PLUGIN_ID]:
    'Reads and writes per-agent memory in the existing agent_configs table. Writes require explicit approval and refuse secret-looking values.',
  [FILES_PLUGIN_ID]:
    'Lists, reads and writes user-scoped ORBIT artifacts through ArtifactStore and lists local safety-trash metadata through SafetyTrash. Mutations require explicit approval; no raw filesystem path is exposed.',
  [BROWSER_PLUGIN_ID]:
    'Confirms and hands http(s) or mailto links to the operating system. It has no page fetcher, no browser automation and no arbitrary-URL WebView.',
  [CODE_PLUGIN_ID]:
    'Education-only programming tutor for DSA problems, code explanation, debugging, complexity and guided learning. Uses the existing AI provider; it has no editor, file editing, execution tool or sandbox coding surface.',
  [TASKS_PLUGIN_ID]:
    'Lists, creates, updates, completes and deletes tasks through the existing task store. Reminder sync and buddy rewards are not reimplemented; mutations require explicit approval.',
  [PROJECTS_PLUGIN_ID]:
    'Read-only workspace composition over chats, tasks, artifacts and workflow runs. It reports the stable workspace and agent-action scope IDs and does not invent project CRUD.',
  [BUDDY_PLUGIN_ID]:
    'Reads buddy state, inventory and evolution options and performs approved activation or evolution through the existing buddy store. Rewards remain owned by tasks.ts and chat-store.ts.',
  [MCP_PLUGIN_ID]:
    'Reads existing MCP mirror status and server metadata and can force an approved re-sync. It has no second HTTP transport, gate or synthetic plugin store.',
  [SANDBOX_PLUGIN_ID]:
    'Android-only data-only arithmetic and string programs in the existing isolated process. It rejects raw instructions, has no file/network/device access, and fails closed on iOS and web.',
};

export {
  AGENT_PLUGIN_ID,
  BUDDY_PLUGIN_ID,
  BROWSER_PLUGIN_ID,
  CODE_PLUGIN_ID,
  FILES_PLUGIN_ID,
  MCP_PLUGIN_ID,
  MEMORY_PLUGIN_ID,
  PROJECTS_PLUGIN_ID,
  SANDBOX_PLUGIN_ID,
  TASKS_PLUGIN_ID,
};

/**
 * Attaches reviewed host code to native plugin entries. Declarative plugins and
 * untrusted manifests never reach this function.
 */
export function registerNativePluginImplementations(
  registry: PluginRegistry
): void {
  for (const { manifest, implementation } of NATIVE_PLUGIN_DEFINITIONS) {
    if (manifest.entryPoint.kind !== 'builtin') {
      continue;
    }

    registry.registerImplementation(manifest.pluginId, implementation);
  }
}
