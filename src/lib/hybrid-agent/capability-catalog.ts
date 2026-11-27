import { agentToolRegistry } from '../ai/tool-registry';
import type { AgentConfig } from '../agent-settings';
import { isToolAllowedForAgent } from '../agent-settings';
import type { CapabilityGrant } from '../agent-runtime/types';

import type { CapabilityDescriptor, HybridRiskLevel } from './types';

const SENSITIVE_PREFIXES = [
  'delete_',
  'mcp__',
  'terminal__',
  'fs__',
  'google_gmail_send',
  'google_calendar_',
  'google_drive_',
  'computer_execute',
  'orbit_plugin_request',
];

const PROHIBITED_NAMES = new Set([
  'sandbox_execute',
  'sandbox.run',
  'eval',
  'execute_code',
  'run_shell',
]);

export function isProhibitedCapability(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return (
    PROHIBITED_NAMES.has(normalized) ||
    normalized.includes('bypass_sandbox') ||
    normalized.includes('grant_permission')
  );
}

export function isSensitiveCapability(toolName: string): boolean {
  const normalized = toolName.trim().toLowerCase();
  return SENSITIVE_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function riskHintFor(toolName: string): HybridRiskLevel {
  if (isProhibitedCapability(toolName)) return 'critical';
  const normalized = toolName.toLowerCase();
  if (
    normalized.startsWith('delete_') ||
    normalized.startsWith('terminal__') ||
    normalized.includes('send') ||
    normalized.includes('install')
  ) {
    return 'high';
  }
  if (isSensitiveCapability(toolName)) return 'medium';
  return 'low';
}

/**
 * Read-only discovery across the canonical tool registry, declarative skill
 * tools and MCP-mirrored tools. No capability here can execute by itself.
 */
export function buildCapabilityCatalog(input: {
  agentConfig?: AgentConfig;
  grants?: CapabilityGrant[];
  skillNames?: string[];
} = {}): CapabilityDescriptor[] {
  const descriptors = agentToolRegistry.descriptors();
  const catalog: CapabilityDescriptor[] = [];

  for (const descriptor of descriptors) {
    const name = descriptor.definition.name;
    if (input.agentConfig && !isToolAllowedForAgent(input.agentConfig, name)) continue;
    if (input.grants && !input.grants.some((grant) => grant.toolName === name)) continue;

    const source = descriptor.meta?.source;
    const kind =
      source === 'plugin' ? 'plugin' : source === 'mcp' ? 'mcp' : source === 'connection' ? 'plugin' : 'builtin';

    catalog.push({
      name,
      kind,
      description: descriptor.definition.description,
      riskHint: riskHintFor(name),
      sensitive: isSensitiveCapability(name),
    });
  }

  for (const name of input.skillNames ?? []) {
    if (catalog.some((entry) => entry.name === name)) continue;
    catalog.push({
      name,
      kind: 'skill',
      description: 'Declarative, data-only skill workflow.',
      riskHint: riskHintFor(name),
      sensitive: isSensitiveCapability(name),
    });
  }

  return catalog;
}

export function findCapability(
  catalog: CapabilityDescriptor[],
  toolName: string
): CapabilityDescriptor | null {
  return catalog.find((entry) => entry.name === toolName) ?? null;
}
