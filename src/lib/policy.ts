import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

export type PolicyDecision = 'allow' | 'deny' | 'ask';

export type SandboxConstraints = {
  /** Path prefixes the tool is allowed to touch. Empty = no path restriction. */
  allowedPaths?: string[];
  /** Path prefixes the tool must never touch. */
  deniedPaths?: string[];
  /** Command prefixes the tool is allowed to run. Empty = allow all. */
  allowedCommands?: string[];
  /** Command prefixes the tool must never run. */
  deniedCommands?: string[];
  /** Whether the tool may make outbound network requests. */
  allowNetwork?: boolean;
};

export type ToolPolicyRule = {
  id: string;
  name: string;
  description: string;
  /** How `pattern` matches the tool name. */
  match: 'exact' | 'prefix';
  pattern: string;
  decision: PolicyDecision;
  enabled: boolean;
  sandbox: SandboxConstraints;
};

export type PolicyEvaluation = {
  decision: PolicyDecision;
  ruleId: string | null;
  ruleName: string | null;
  sandbox: SandboxConstraints;
  reason: string;
};

export type ToolTelemetryPolicy = {
  decision: PolicyDecision;
  ruleId: string | null;
  ruleName: string | null;
};

const POLICY_KEY = 'orbit.policy.rules.v1';

type WebStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function getWebStorage(): WebStorage | null {
  return (globalThis as { localStorage?: WebStorage }).localStorage ?? null;
}

function matchesPattern(pattern: string, match: ToolPolicyRule['match'], toolName: string): boolean {
  if (match === 'exact') {
    return toolName === pattern;
  }

  return toolName.startsWith(pattern);
}

function defaultRules(): ToolPolicyRule[] {
  return [
    {
      id: 'policy.task.create',
      name: 'Create task',
      description: 'Creating new tasks is allowed.',
      match: 'exact',
      pattern: 'create_task',
      decision: 'allow',
      enabled: true,
      sandbox: {},
    },
    {
      id: 'policy.task.list',
      name: 'List tasks',
      description: 'Listing tasks is allowed.',
      match: 'exact',
      pattern: 'list_tasks',
      decision: 'allow',
      enabled: true,
      sandbox: {},
    },
    {
      id: 'policy.task.complete',
      name: 'Complete task',
      description: 'Marking tasks complete is allowed.',
      match: 'exact',
      pattern: 'complete_task',
      decision: 'allow',
      enabled: true,
      sandbox: {},
    },
    {
      id: 'policy.task.update',
      name: 'Update task',
      description: 'Updating tasks is allowed.',
      match: 'exact',
      pattern: 'update_task',
      decision: 'allow',
      enabled: true,
      sandbox: {},
    },
    {
      id: 'policy.task.delete',
      name: 'Delete task',
      description: 'Deleting tasks is destructive and requires approval.',
      match: 'exact',
      pattern: 'delete_task',
      decision: 'ask',
      enabled: true,
      sandbox: {},
    },
    {
      id: 'policy.mcp.external',
      name: 'External MCP tools',
      description: 'Tools from external MCP servers require approval.',
      match: 'prefix',
      pattern: 'mcp__',
      decision: 'ask',
      enabled: true,
      sandbox: { allowNetwork: true },
    },
    {
      id: 'policy.terminal.default',
      name: 'Terminal commands',
      description: 'Terminal execution is sandboxed and requires approval.',
      match: 'prefix',
      pattern: 'terminal__',
      decision: 'ask',
      enabled: true,
      sandbox: {
        allowedCommands: [],
        deniedCommands: ['rm', 'sudo', 'format', 'mkfs', 'shutdown', 'reboot'],
      },
    },
    {
      id: 'policy.fs.write',
      name: 'File system writes',
      description: 'Writing to local files requires approval.',
      match: 'prefix',
      pattern: 'fs__',
      decision: 'ask',
      enabled: true,
      sandbox: { deniedPaths: ['/etc', '/system', '/var', '/proc', '/sys'] },
    },
  ];
}

let cachedRules: ToolPolicyRule[] | null = null;

/**
 * Policy engine. Every tool call is evaluated against registered rules; the
 * first matching enabled rule wins. Rules can allow, deny, or ask for approval.
 * Sandbox constraints travel with the decision so callers can confine execution.
 */
export class PolicyEngine {
  constructor() {
    this.restoreDefaults();
  }

  private loadRules(): ToolPolicyRule[] {
    if (cachedRules) {
      return cachedRules.map((rule) => ({ ...rule }));
    }

    try {
      const raw =
        Platform.OS === 'web'
          ? getWebStorage()?.getItem(POLICY_KEY) ?? null
          : SecureStore.getItemAsync(POLICY_KEY);

      const value = typeof raw === 'string' ? raw : null;

      if (value) {
        cachedRules = normalizeList(JSON.parse(value));
        return cachedRules.map((rule) => ({ ...rule }));
      }
    } catch {
      // Ignore corrupt storage; fall back to defaults.
    }

    return defaultRules().map((rule) => ({ ...rule }));
  }

  private saveRules(rules: ToolPolicyRule[]): void {
    const normalized = normalizeList(rules);
    cachedRules = normalized;

    try {
      const raw = JSON.stringify(normalized);

      if (Platform.OS === 'web') {
        getWebStorage()?.setItem(POLICY_KEY, raw);
      } else {
        SecureStore.setItemAsync(POLICY_KEY, raw);
      }
    } catch {
      // Storage failures must not block policy evaluation.
    }
  }

  private normalizeRules(rules: ToolPolicyRule[]): ToolPolicyRule[] {
    return normalizeList(rules);
  }

  restoreDefaults(): void {
    cachedRules = defaultRules().map((rule) => ({ ...rule }));
    this.saveRules(cachedRules);
  }

  listRules(): ToolPolicyRule[] {
    return this.loadRules();
  }

  getRule(id: string): ToolPolicyRule | null {
    return this.listRules().find((rule) => rule.id === id) ?? null;
  }

  registerRule(rule: ToolPolicyRule): void {
    const next = this.listRules().map((existing) =>
      existing.id === rule.id ? { ...rule } : existing
    );

    if (!next.some((existing) => existing.id === rule.id)) {
      next.push({ ...rule });
    }

    this.saveRules(next);
  }

  updateRule(id: string, patch: Partial<ToolPolicyRule>): void {
    const next = this.listRules().map((rule) =>
      rule.id === id ? { ...rule, ...patch } : rule
    );

    this.saveRules(next);
  }

  setRuleEnabled(id: string, enabled: boolean): void {
    this.updateRule(id, { enabled });
  }

  deleteRule(id: string): void {
    this.saveRules(this.listRules().filter((rule) => rule.id !== id));
  }

  /**
   * Evaluates a tool call against the active rules. The first matching enabled
   * rule wins; if nothing matches, the tool is allowed.
   */
  evaluate(
    toolName: string,
    args: Record<string, unknown>
  ): PolicyEvaluation {
    for (const rule of this.listRules()) {
      if (!rule.enabled) {
        continue;
      }

      if (!matchesPattern(rule.pattern, rule.match, toolName)) {
        continue;
      }

      return {
        decision: rule.decision,
        ruleId: rule.id,
        ruleName: rule.name,
        sandbox: { ...rule.sandbox },
        reason: rule.description,
      };
    }

    return {
      decision: 'allow',
      ruleId: null,
      ruleName: null,
      sandbox: {},
      reason: 'No matching policy rule.',
    };
  }
}

function normalizeList(value: unknown): ToolPolicyRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const rules: ToolPolicyRule[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const rule = item as Partial<ToolPolicyRule>;

    if (!rule.id || !rule.name || !rule.pattern) {
      continue;
    }

    const normalized: ToolPolicyRule = {
      id: rule.id,
      name: rule.name,
      description: rule.description ?? '',
      match: rule.match ?? 'exact',
      pattern: rule.pattern,
      decision: rule.decision ?? 'allow',
      enabled: rule.enabled ?? true,
      sandbox: rule.sandbox ?? {},
    };

    if (!seen.has(normalized.id)) {
      seen.add(normalized.id);
      rules.push(normalized);
    }
  }

  return rules;
}

export const policyEngine = new PolicyEngine();
