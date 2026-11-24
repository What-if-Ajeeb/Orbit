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
const POLICY_DELETED_KEY = 'orbit.policy.deleted.v1';

const GOOGLE_READ_TOOLS = [
  'google_gmail_search',
  'google_gmail_read',
  'google_calendar_search',
  'google_drive_search',
  'google_drive_read',
];

const GOOGLE_WRITE_TOOLS = [
  'google_gmail_draft',
  'google_gmail_send',
  'google_calendar_create',
  'google_calendar_update',
  'google_drive_trash',
];

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
      id: 'policy.artifact.local',
      name: 'Artifacts',
      description: 'Reading and saving local artifacts is allowed.',
      match: 'prefix',
      pattern: 'artifact_',
      decision: 'allow',
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
    ...GOOGLE_WRITE_TOOLS.map(
      (toolName): ToolPolicyRule => ({
        id: `policy.google.${toolName}`,
        name: `Connected Google: ${toolName.replace(/^google_/, '').replaceAll('_', ' ')}`,
        description: 'Changing connected Google data requires explicit approval.',
        match: 'exact',
        pattern: toolName,
        decision: 'ask',
        enabled: true,
        sandbox: { allowNetwork: true },
      })
    ),
    ...GOOGLE_READ_TOOLS.map(
      (toolName): ToolPolicyRule => ({
        id: `policy.google.${toolName}`,
        name: `Connected Google: ${toolName.replace(/^google_/, '').replaceAll('_', ' ')}`,
        description: 'Reading connected Google content requires explicit approval.',
        match: 'exact',
        pattern: toolName,
        decision: 'ask',
        enabled: true,
        sandbox: { allowNetwork: true },
      })
    ),
  ];
}

/**
 * Stored rules win over defaults so user choices survive upgrades. Explicitly
 * deleted defaults stay deleted via a separate tombstone list.
 */
function withCurrentDefaults(
  stored: ToolPolicyRule[],
  deleted: Set<string>
): ToolPolicyRule[] {
  const defaults = defaultRules();
  const storedById = new Map(stored.map((rule) => [rule.id, rule]));
  const merged = defaults
    .filter((rule) => !deleted.has(rule.id))
    .map((rule) => storedById.get(rule.id) ?? rule);
  const defaultIds = new Set(defaults.map((rule) => rule.id));

  for (const rule of stored) {
    if (!defaultIds.has(rule.id) && !deleted.has(rule.id)) {
      merged.push(rule);
    }
  }

  return merged;
}

function parseDeletedIds(raw: string | null): Set<string> {
  if (!raw) {
    return new Set<string>();
  }

  try {
    return normalizeIdList(JSON.parse(raw));
  } catch {
    return new Set<string>();
  }
}

let cachedRules: ToolPolicyRule[] = defaultRules();
let deletedRuleIds = new Set<string>();
let ruleRevision = 0;
let writeChain: Promise<void> = Promise.resolve();
let hydrationPromise: Promise<void> | null = null;

async function hydrateRules(): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }

  const revision = ++ruleRevision;

  try {
    const [rawRules, rawDeleted] = await Promise.all([
      SecureStore.getItemAsync(POLICY_KEY),
      SecureStore.getItemAsync(POLICY_DELETED_KEY),
    ]);

    // A write that happened while reading wins; never resurrect stale rules.
    if (revision !== ruleRevision) {
      return;
    }

    deletedRuleIds = parseDeletedIds(rawDeleted);
    cachedRules = rawRules
      ? withCurrentDefaults(normalizeList(JSON.parse(rawRules)), deletedRuleIds)
      : withCurrentDefaults(defaultRules(), deletedRuleIds);
  } catch {
    // Ignore corrupt storage; keep defaults.
  }
}

function persistRules(rules: ToolPolicyRule[]): void {
  const normalized = normalizeList(rules);
  cachedRules = normalized;
  ruleRevision += 1;

  try {
    const rawRules = JSON.stringify(normalized);
    const rawDeleted = JSON.stringify(Array.from(deletedRuleIds));

    if (Platform.OS === 'web') {
      getWebStorage()?.setItem(POLICY_KEY, rawRules);
      getWebStorage()?.setItem(POLICY_DELETED_KEY, rawDeleted);
      return;
    }

    const write = Promise.all([
      SecureStore.setItemAsync(POLICY_KEY, rawRules),
      SecureStore.setItemAsync(POLICY_DELETED_KEY, rawDeleted),
    ])
      .then(() => undefined)
      .catch(() => {
        // Storage failures must not block policy evaluation.
      });

    writeChain = writeChain.then(() => write);
  } catch {
    // Storage failures must not block policy evaluation.
  }
}

/** Reloads persisted rules. Safe to call after sign-in or in tests. */
export async function reloadPolicyRules(): Promise<void> {
  await writeChain;
  hydrationPromise = hydrateRules();
  return hydrationPromise;
}

/** Resolves once the initial native SecureStore read has completed. */
export function waitForPolicyHydration(): Promise<void> {
  return hydrationPromise ?? Promise.resolve();
}

/** Resolves once queued native SecureStore writes have completed. */
export function waitForPolicyWrites(): Promise<void> {
  return writeChain;
}

/**
 * Policy engine. Every tool call is evaluated against registered rules; the
 * first matching enabled rule wins. Rules can allow, deny, or ask for approval.
 * Sandbox constraints travel with the decision so callers can confine execution.
 */
export class PolicyEngine {
  constructor() {
    if (Platform.OS === 'web') {
      try {
        const raw = getWebStorage()?.getItem(POLICY_KEY);
        const rawDeleted = getWebStorage()?.getItem(POLICY_DELETED_KEY) ?? null;
        deletedRuleIds = parseDeletedIds(rawDeleted);
        cachedRules = raw
          ? withCurrentDefaults(normalizeList(JSON.parse(raw)), deletedRuleIds)
          : withCurrentDefaults(defaultRules(), deletedRuleIds);
      } catch {
        deletedRuleIds = new Set<string>();
        cachedRules = defaultRules();
      }
      return;
    }

    cachedRules = defaultRules();
    hydrationPromise = hydrateRules();
  }

  listRules(): ToolPolicyRule[] {
    return cachedRules.map((rule) => ({ ...rule }));
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

    deletedRuleIds.delete(rule.id);
    persistRules(next);
  }

  updateRule(id: string, patch: Partial<ToolPolicyRule>): void {
    persistRules(
      this.listRules().map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    );
  }

  setRuleEnabled(id: string, enabled: boolean): void {
    this.updateRule(id, { enabled });
  }

  deleteRule(id: string): void {
    deletedRuleIds.add(id);
    persistRules(this.listRules().filter((rule) => rule.id !== id));
  }

  restoreDefaults(): void {
    deletedRuleIds.clear();
    persistRules(defaultRules());
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

  const decisions = new Set<PolicyDecision>(['allow', 'deny', 'ask']);
  const seen = new Set<string>();
  const rules: ToolPolicyRule[] = [];

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    const rule = item as Partial<ToolPolicyRule>;

    if (
      typeof rule.id !== 'string' ||
      !rule.id ||
      typeof rule.name !== 'string' ||
      !rule.name ||
      typeof rule.pattern !== 'string' ||
      !rule.pattern
    ) {
      continue;
    }

    const normalized: ToolPolicyRule = {
      id: rule.id,
      name: rule.name,
      description: typeof rule.description === 'string' ? rule.description : '',
      match: rule.match === 'prefix' ? 'prefix' : 'exact',
      pattern: rule.pattern,
      decision: rule.decision && decisions.has(rule.decision) ? rule.decision : 'ask',
      enabled: typeof rule.enabled === 'boolean' ? rule.enabled : true,
      sandbox:
        rule.sandbox && typeof rule.sandbox === 'object' && !Array.isArray(rule.sandbox)
          ? rule.sandbox
          : {},
    };

    if (!seen.has(normalized.id)) {
      seen.add(normalized.id);
      rules.push(normalized);
    }
  }

  return rules;
}

function normalizeIdList(value: unknown): Set<string> {
  const ids = new Set<string>();

  if (!Array.isArray(value)) {
    return ids;
  }

  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      ids.add(item.trim());
    }
  }

  return ids;
}

export const policyEngine = new PolicyEngine();
