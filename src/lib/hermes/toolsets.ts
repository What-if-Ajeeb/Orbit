import type { AgentConfig } from '../agent-settings';
import { filterAllowedTools } from '../agent-settings';
import { listAgentTools } from '../ai/tools';
import type { CapabilityGrant } from '../agent-runtime/types';

import type { ToolsetDescriptor } from './types';

/**
 * Hermes-style toolsets over ORBIT's single canonical tool registry. A toolset
 * is a read-only grouping: it never registers, enables, or invokes a tool.
 */
const TOOLSET_RULES: { id: string; label: string; pattern: RegExp }[] = [
  { id: 'tasks', label: 'Tasks and reminders', pattern: /^(?:create|list|complete|delete|update)_task|^schedule_/ },
  { id: 'memory', label: 'Memory', pattern: /^memory_/ },
  { id: 'web', label: 'Web', pattern: /^(?:web_|search_web)|search_web$/ },
  { id: 'mcp', label: 'Connected MCP servers', pattern: /^mcp__/ },
  { id: 'plugins', label: 'Plugins and onboarding', pattern: /^orbit_plugin_|^plugin__/ },
  { id: 'skills', label: 'Declarative skills', pattern: /^skill_/ },
  { id: 'artifacts', label: 'Artifacts', pattern: /^artifact_/ },
  { id: 'files', label: 'Files and sandbox reads', pattern: /^fs__|^sandbox_read_file|^read_file|^search_files/ },
];

function isActiveGrant(grant: CapabilityGrant, toolName: string): boolean {
  return (
    grant.toolName === toolName &&
    (grant.status ?? 'active') !== 'revoked' &&
    (!grant.expiresAt || grant.expiresAt > Date.now())
  );
}

export function buildToolsets(input: {
  agentConfig?: AgentConfig;
  grants?: CapabilityGrant[];
  toolNames?: string[];
} = {}): ToolsetDescriptor[] {
  const registered = input.toolNames ?? listAgentTools().map((tool) => tool.name);
  const allowed = input.agentConfig
    ? filterAllowedTools(registered.map((name) => ({ name })), input.agentConfig).map((tool) => tool.name)
    : registered;
  const grants = input.grants;
  const available = grants
    ? allowed.filter((name) => grants.some((grant) => isActiveGrant(grant, name)))
    : allowed;

  const descriptors = TOOLSET_RULES.map((rule) => ({
    id: rule.id,
    label: rule.label,
    tools: registered.filter((name) => rule.pattern.test(name)),
    available: available.filter((name) => rule.pattern.test(name)),
  })).filter((descriptor) => descriptor.tools.length > 0);

  const claimed = new Set(descriptors.flatMap((descriptor) => descriptor.tools));
  const otherTools = registered.filter((name) => !claimed.has(name));
  if (otherTools.length > 0) {
    descriptors.push({
      id: 'other',
      label: 'Other built-in tools',
      tools: otherTools,
      available: available.filter((name) => otherTools.includes(name)),
    });
  }

  return descriptors;
}

export function availableToolNames(toolsets: ToolsetDescriptor[]): Set<string> {
  return new Set(toolsets.flatMap((descriptor) => descriptor.available));
}
