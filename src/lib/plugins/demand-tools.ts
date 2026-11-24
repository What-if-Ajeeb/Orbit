import {
  agentToolRegistry,
  toolFail,
  toolOk,
  type AgentTool,
  type ToolExecution,
} from '@/lib/ai/tool-registry';

import {
  DEMAND_CAPABILITIES,
  DEMAND_CAPABILITY_LABEL,
  inferDemandCapabilities,
  type DemandCapability,
  type DemandMode,
} from './demand';
import { getSmartPluginInstaller } from './demand-runtime';
import { getPluginPlatform } from './platform';

const MAX_TASK_CHARS = 2_000;
const MAX_PLUGIN_ID_CHARS = 120;

function clamp(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function capabilityOf(value: unknown): DemandCapability | null {
  return typeof value === 'string' && DEMAND_CAPABILITIES.includes(value as DemandCapability)
    ? (value as DemandCapability)
    : null;
}

function modeOf(value: unknown): DemandMode {
  return value === 'learn' || value === 'auto' ? value : 'agent';
}

function unavailable(): ToolExecution {
  return {
    content: toolFail('The plugin platform is still starting. Try again in a moment.'),
    trace: 'plugin demand: platform unavailable',
  };
}

const discoverTool: AgentTool = {
  meta: { source: 'builtin' },
  definition: {
    name: 'orbit_plugin_discover',
    description:
      'Find trusted, compatible ORBIT plugins or configured MCP servers for a capability. Read-only: it never installs, enables or grants permissions. Use mode "learn" for DSA/programming learning and "agent" for GitHub, docs, testing, research, build or MCP work.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'The user task or capability need. Kept on this device.',
        },
        capability: {
          type: 'string',
          description: 'Optional exact capability: ' + DEMAND_CAPABILITIES.join(', '),
        },
        mode: {
          type: 'string',
          description: 'learn, agent or auto. Defaults to agent.',
        },
      },
      required: [],
    },
  },
  execute: async (_context, args) => {
    const installer = getSmartPluginInstaller(getPluginPlatform());

    if (!installer) {
      return unavailable();
    }

    const mode = modeOf(args.mode);
    const task = clamp(args.task, MAX_TASK_CHARS);
    const requested = capabilityOf(args.capability);
    const inferred = requested
      ? [requested]
      : inferDemandCapabilities(task, mode);
    const capabilities = inferred.length > 0 ? inferred : DEMAND_CAPABILITIES;
    const seen = new Set<string>();
    const candidates = [];

    for (const capability of capabilities) {
      const matches = await installer.listCandidates({ capability, mode, limit: 8 });

      for (const candidate of matches) {
        if (seen.has(candidate.pluginId)) {
          continue;
        }

        seen.add(candidate.pluginId);
        candidates.push({
          pluginId: candidate.pluginId,
          pluginName: candidate.pluginName,
          version: candidate.version,
          capability,
          capabilityLabel: DEMAND_CAPABILITY_LABEL[capability],
          description: candidate.description.slice(0, 240),
          registry: candidate.registry,
          trustLevel: candidate.trustLevel,
          publisherVerified: candidate.publisherVerified,
          installed: candidate.installed,
          running: candidate.running,
          hasUpdate: candidate.hasUpdate,
          permissions: candidate.permissions,
          sensitivePermissions: candidate.sensitivePermissions,
        });
      }
    }

    return {
      content: toolOk({
        mode,
        inferredCapabilities: inferred,
        candidates: candidates.slice(0, 20),
      }),
      trace: `plugin discovery: ${candidates.length} trusted candidate(s)`,
    };
  },
};

const requestTool: AgentTool = {
  meta: { source: 'builtin' },
  definition: {
    name: 'orbit_plugin_request',
    description:
      'Request the minimum trusted plugin needed for the current task. Shows the plugin, version, publisher, dependencies and permissions in a native approval dialog. The platform installs and activates it only after the user approves; denial changes nothing.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description: 'Why this capability is needed for the current user task.',
        },
        capability: {
          type: 'string',
          description: 'Capability discovered with orbit_plugin_discover.',
        },
        pluginId: {
          type: 'string',
          description: 'Optional specific trusted candidate from discovery.',
        },
        mode: {
          type: 'string',
          description: 'learn, agent or auto. Defaults to agent.',
        },
      },
      required: ['task'],
    },
  },
  execute: async (_context, args) => {
    const installer = getSmartPluginInstaller(getPluginPlatform());

    if (!installer) {
      return unavailable();
    }

    const task = clamp(args.task, MAX_TASK_CHARS);
    const pluginId = clamp(args.pluginId, MAX_PLUGIN_ID_CHARS) || undefined;
    const result = await installer.resolve({
      task,
      reason: task,
      capability: capabilityOf(args.capability) ?? undefined,
      pluginId,
      mode: modeOf(args.mode),
    });

    const toolNames = result.ok
      ? agentToolRegistry
          .descriptors()
          .filter((descriptor) => descriptor.meta?.pluginId === result.pluginId)
          .map((descriptor) => descriptor.definition.name)
      : [];

    if (!result.ok) {
      return {
        content: toolFail(`${result.error} (${result.code})`),
        trace: `plugin request: ${result.code}`,
      };
    }

    return {
      content: toolOk({
        ...result,
        capabilityLabel: DEMAND_CAPABILITY_LABEL[result.capability],
        toolNames,
        note:
          toolNames.length > 0
            ? 'The installed plugin contributed these agent tools for the next step.'
            : 'The plugin is active. If it contributes no agent tools, use its ORBIT screen instead.',
      }),
      trace: `plugin ${result.action}: ${result.pluginName} ${result.version}`,
    };
  },
};

export function buildDemandTools(): AgentTool[] {
  return [discoverTool, requestTool];
}
