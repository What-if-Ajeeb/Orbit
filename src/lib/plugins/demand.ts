/**
 * Demand-based plugin discovery and installation planning.
 *
 * This module is host-neutral: it never imports React Native, SQLite or a
 * global platform instance. It reads the existing PluginRegistry catalog and
 * the user's configured MCP servers, then returns a plan that must be approved
 * before the existing PluginRegistry lifecycle is allowed to install anything.
 * No remote manifests, downloaded code or second runtime are introduced here.
 */

import type { McpServerConfig } from '@/lib/mcp/settings';

import { buildMcpPluginManifest } from './mcp-bridge';
import { validateManifest } from './manifest';
import type {
  PluginApprovalService,
  PluginInstallInspection,
} from './approvals';
import {
  isSensitivePermission,
  PLUGIN_PERMISSION_META,
} from './permissions';
import type { PluginRegistry } from './registry';
import type { PluginKeyValueStorage } from './storage';
import { PLUGIN_PERMISSIONS, PLUGIN_TRUST_LEVELS } from './types';
import type {
  PluginCatalogEntry,
  PluginDependency,
  PluginManifest,
  PluginPermission,
  PluginStatus,
  PluginSummary,
  PluginTrustLevel,
} from './types';
import { isVersionGreater, isValidSemver, satisfiesRange } from './semver';

export const DEMAND_CAPABILITIES = [
  'learn_dsa',
  'learn_programming',
  'learn_general',
  'agent_github',
  'agent_docs',
  'agent_testing',
  'agent_research',
  'agent_build',
  'agent_mcp',
] as const;

export type DemandCapability = (typeof DEMAND_CAPABILITIES)[number];
export type DemandMode = 'learn' | 'agent' | 'auto';

export const DEMAND_CAPABILITY_LABEL: Record<DemandCapability, string> = {
  learn_dsa: 'Data structures and algorithms learning',
  learn_programming: 'Programming learning',
  learn_general: 'General study support',
  agent_github: 'GitHub and repository work',
  agent_docs: 'Documentation and API reference',
  agent_testing: 'Testing and debugging',
  agent_research: 'Research and source discovery',
  agent_build: 'Build and release tooling',
  agent_mcp: 'MCP tool integrations',
};

const CAPABILITY_TERMS: Record<DemandCapability, string[]> = {
  learn_dsa: [
    'dsa',
    'data structure',
    'data structures',
    'algorithm',
    'algorithms',
    'linked list',
    'binary tree',
    'graph traversal',
    'sorting',
    'searching',
    'dynamic programming',
    'leetcode',
  ],
  learn_programming: [
    'learn programming',
    'code tutorial',
    'javascript',
    'typescript',
    'python',
    'react native',
    'kotlin',
    'rust',
    'sql',
    'java',
    'c++',
  ],
  learn_general: [
    'study',
    'tutorial',
    'homework',
    'practice problem',
    'quiz',
    'explain concept',
    'learn',
  ],
  agent_github: [
    'github',
    'git',
    'pull request',
    'issue',
    'repository',
    'repo',
    'commit',
    'branch',
  ],
  agent_docs: [
    'documentation',
    'docs',
    'api reference',
    'readme',
    'sdk',
    'manual',
  ],
  agent_testing: [
    'test',
    'tests',
    'jest',
    'vitest',
    'unit test',
    'debug',
    'coverage',
    'lint',
  ],
  agent_research: [
    'research',
    'search web',
    'lookup',
    'find information',
    'news',
    'summarize article',
  ],
  agent_build: [
    'build',
    'compile',
    'gradle',
    'expo',
    'apk',
    'aab',
    'release',
    'ci',
  ],
  agent_mcp: ['mcp', 'model context protocol', 'external tool', 'tool server'],
};

const LEARN_CAPABILITIES: DemandCapability[] = [
  'learn_dsa',
  'learn_programming',
  'learn_general',
];
const AGENT_CAPABILITIES: DemandCapability[] = [
  'agent_github',
  'agent_docs',
  'agent_testing',
  'agent_research',
  'agent_build',
  'agent_mcp',
];

const MAX_TASK_CHARS = 2_000;
const MAX_REASON_CHARS = 400;
const MAX_QUERY_CHARS = 120;
const MAX_RESULT_LIMIT = 40;
const MAX_HISTORY = 60;
const DEFAULT_IDLE_MS = 7 * 24 * 60 * 60 * 1_000;

export const DEMAND_STATE_PLUGIN_ID = 'orbit.smart-installer';
export const DEMAND_STATE_KEY = 'state';

export type DemandRegistrySource =
  | 'bundled-catalog'
  | 'configured-mcp'
  | 'installed';

export type DemandCandidate = {
  pluginId: string;
  pluginName: string;
  version: string;
  description: string;
  capability: DemandCapability | null;
  registry: DemandRegistrySource;
  trustLevel: PluginTrustLevel;
  publisherVerified: boolean;
  compatible: boolean;
  installed: boolean;
  running: boolean;
  hasUpdate: boolean;
  permissions: PluginPermission[];
  sensitivePermissions: PluginPermission[];
  manifest: PluginManifest;
  score: number;
  matchedTerms: string[];
};

export type DemandDependency = {
  pluginId: string;
  name: string;
  version: string;
  status: PluginStatus | 'unavailable';
  installed: boolean;
  running: boolean;
  requiresUpdate: boolean;
  permissions: PluginPermission[];
  sensitivePermissions: PluginPermission[];
  manifest?: PluginManifest | null;
  updateManifest?: PluginManifest | null;
};

export type DemandPlan = {
  pluginId: string;
  pluginName: string;
  version: string;
  capability: DemandCapability;
  mode: DemandMode;
  reason: string;
  registry: DemandRegistrySource;
  trustLevel: PluginTrustLevel;
  publisherVerified: boolean;
  permissions: PluginPermission[];
  sensitivePermissions: PluginPermission[];
  dependencies: DemandDependency[];
  requiresInstall: boolean;
  requiresUpdate: boolean;
  requiresEnable: boolean;
  requiresSandbox: boolean;
  updateManifest?: PluginManifest;
  steps: string[];
  /** Exact facts the user inspects before the install approval. */
  inspection: PluginInstallInspection;
};

export type DemandPlanResult =
  | { ok: true; plan: DemandPlan }
  | { ok: false; errors: string[] };

export type DemandUsageRecord = {
  pluginId: string;
  capability: DemandCapability;
  agentId: string | null;
  mode: DemandMode;
  status: 'reused' | 'installed' | 'updated' | 'enabled' | 'denied' | 'failed';
  createdAt: number;
  requestId?: number | null;
  inspection?: PluginInstallInspection | null;
};

export type AutoInstalledPlugin = {
  pluginId: string;
  pluginName: string;
  version: string;
  capability: DemandCapability;
  registry: DemandRegistrySource;
  installedAt: number;
  lastUsedAt: number;
  usageCount: number;
  disabledAt: number | null;
};

export type SmartPluginState = {
  version: 1;
  autoInstalled: Record<string, AutoInstalledPlugin>;
  usage: DemandUsageRecord[];
};

export type DemandRequest = {
  task?: string;
  reason?: string;
  capability?: DemandCapability;
  pluginId?: string;
  mode?: DemandMode;
  agentId?: string | null;
  /** Cancels a pending install approval; cancellation never changes plugins. */
  signal?: AbortSignal;
};

export type DemandResultMeta = {
  /** Id of the native approval request, when one was shown. */
  requestId?: number | null;
  /** Exact package facts that were inspected before approval. */
  inspection?: PluginInstallInspection | null;
};

export type DemandResult =
  | ({
      ok: true;
      action: 'reused' | 'installed' | 'updated' | 'enabled';
      pluginId: string;
      pluginName: string;
      version: string;
      capability: DemandCapability;
      registry: DemandRegistrySource;
      reason: string;
    } & DemandResultMeta)
  | ({
      ok: false;
      code:
        | 'no-capability'
        | 'unavailable'
        | 'denied'
        | 'cancelled'
        | 'install-failed'
        | 'platform-unavailable';
      error: string;
      candidates: string[];
    } & DemandResultMeta);

type RegistryLike = Pick<
  PluginRegistry,
  'getCatalogEntries' | 'getSummaries' | 'getRecord'
>;

function normalizeText(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max).toLowerCase();
}

function escapeTerm(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Constant-term boundary match; no user input becomes a regular expression. */
function hasTerm(text: string, term: string): boolean {
  const clean = normalizeText(term, MAX_QUERY_CHARS);

  if (!clean) {
    return false;
  }

  const pattern = `(^|[^a-z0-9])${escapeTerm(clean)}([^a-z0-9]|$)`;
  return new RegExp(pattern).test(text);
}

function capabilitiesForMode(mode: DemandMode): DemandCapability[] {
  if (mode === 'learn') {
    return LEARN_CAPABILITIES;
  }

  if (mode === 'agent') {
    return AGENT_CAPABILITIES;
  }

  return [...LEARN_CAPABILITIES, ...AGENT_CAPABILITIES];
}

export function inferDemandCapabilities(
  task: string,
  mode: DemandMode = 'agent'
): DemandCapability[] {
  const text = normalizeText(task, MAX_TASK_CHARS);
  const found: DemandCapability[] = [];

  for (const capability of capabilitiesForMode(mode)) {
    if (CAPABILITY_TERMS[capability].some((term) => hasTerm(text, term))) {
      found.push(capability);
    }
  }

  return found;
}

function manifestHaystack(
  manifest: PluginManifest,
  readme = ''
): string {
  return normalizeText(
    [
      manifest.name,
      manifest.description,
      manifest.category,
      manifest.capabilities.join(' '),
      manifest.mcpTools.map((tool) => `${tool.name} ${tool.description}`).join(' '),
      readme,
    ].join(' '),
    MAX_TASK_CHARS * 2
  );
}

function scoreCandidate(
  haystack: string,
  capability: DemandCapability | null,
  query: string
): { score: number; matched: string[] } {
  const terms = capability
    ? CAPABILITY_TERMS[capability]
    : normalizeText(query, MAX_QUERY_CHARS)
        .split(' ')
        .filter((term) => term.length > 2)
        .slice(0, 12);

  if (terms.length === 0) {
    return capability ? { score: 0, matched: [] } : { score: 1, matched: [] };
  }

  const matched = terms.filter((term) => hasTerm(haystack, term));

  if (capability && matched.length === 0) {
    return { score: 0, matched: [] };
  }

  return { score: 10 + matched.length * 3, matched: matched.slice(0, 8) };
}

function trustOf(entry: PluginCatalogEntry): boolean {
  return (
    (entry.trustLevel === 'official' || entry.trustLevel === 'verified') &&
    entry.publisher.verified
  );
}

function permissionSummary(permissions: PluginPermission[]): {
  permissions: PluginPermission[];
  sensitivePermissions: PluginPermission[];
} {
  const unique = Array.from(new Set(permissions)).sort((a, b) => a.localeCompare(b));

  return {
    permissions: unique,
    sensitivePermissions: unique.filter(isSensitivePermission),
  };
}

function isInstalledStatus(status: PluginStatus): boolean {
  return !['available', 'discovered', 'installing', 'uninstalling'].includes(status);
}

export function searchDemandRegistry(input: {
  registry: RegistryLike;
  servers?: McpServerConfig[];
  capability?: DemandCapability;
  query?: string;
  mode?: DemandMode;
  limit?: number;
}): DemandCandidate[] {
  const { registry } = input;
  const capability = input.capability ?? null;
  const query = normalizeText(input.query ?? '', MAX_QUERY_CHARS);
  const summaries = new Map<string, PluginSummary>(
    registry.getSummaries().map((summary) => [summary.manifest.pluginId, summary])
  );
  const byId = new Map<string, DemandCandidate>();
  const limit = Math.min(Math.max(Math.trunc(input.limit ?? MAX_RESULT_LIMIT), 1), MAX_RESULT_LIMIT);

  const add = (candidate: DemandCandidate): void => {
    const existing = byId.get(candidate.pluginId);

    if (!existing || candidate.score > existing.score) {
      byId.set(candidate.pluginId, candidate);
    }
  };

  for (const entry of registry.getCatalogEntries()) {
    if (!entry.compatible || !trustOf(entry)) {
      continue;
    }

    const manifest = entry.manifest;
    const summary = summaries.get(manifest.pluginId);
    const scored = scoreCandidate(
      manifestHaystack(manifest, entry.readme),
      capability,
      query
    );

    if (scored.score === 0) {
      continue;
    }

    add({
      pluginId: manifest.pluginId,
      pluginName: manifest.name,
      version: entry.availableVersion,
      description: manifest.description,
      capability,
      registry: summary ? 'installed' : 'bundled-catalog',
      trustLevel: entry.trustLevel,
      publisherVerified: entry.publisher.verified,
      compatible: entry.compatible,
      installed: Boolean(summary && isInstalledStatus(summary.status)),
      running: summary?.running ?? false,
      hasUpdate: entry.hasUpdate,
      ...permissionSummary(manifest.permissions),
      manifest,
      score:
        scored.score +
        (summary?.running ? 6 : 0) +
        (summary && isInstalledStatus(summary.status) ? 4 : 0),
      matchedTerms: scored.matched,
    });
  }

  for (const server of input.servers ?? []) {
    if (!server.enabled || !server.url.trim()) {
      continue;
    }

    const manifest = buildMcpPluginManifest(server);
    const summary = summaries.get(manifest.pluginId);
    const scored = scoreCandidate(manifestHaystack(manifest), capability, query);

    if (scored.score === 0) {
      continue;
    }

    add({
      pluginId: manifest.pluginId,
      pluginName: manifest.name,
      version: manifest.version,
      description: manifest.description,
      capability,
      registry: summary ? 'installed' : 'configured-mcp',
      trustLevel: 'local',
      publisherVerified: false,
      compatible: true,
      installed: Boolean(summary && isInstalledStatus(summary.status)),
      running: summary?.running ?? false,
      hasUpdate: false,
      ...permissionSummary(manifest.permissions),
      manifest,
      score: scored.score + (summary?.running ? 6 : 0),
      matchedTerms: scored.matched,
    });
  }

  // An installed, trusted plugin that is no longer in the catalog can still be
  // reused. It is never reinstalled from this registry.
  for (const summary of summaries.values()) {
    if (!isInstalledStatus(summary.status)) {
      continue;
    }

    // The catalog loop already added the newer manifest for this installed
    // plugin. A stale installed-only candidate would hide the available update.
    if (
      registry
        .getCatalogEntries()
        .some(
          (entry) =>
            entry.manifest.pluginId === summary.manifest.pluginId && entry.hasUpdate
        )
    ) {
      continue;
    }

    if (
      !(
        summary.trustLevel === 'official' ||
        summary.trustLevel === 'verified' ||
        summary.manifest.entryPoint.kind === 'mcp'
      )
    ) {
      continue;
    }

    const scored = scoreCandidate(manifestHaystack(summary.manifest), capability, query);

    if (scored.score === 0) {
      continue;
    }

    add({
      pluginId: summary.manifest.pluginId,
      pluginName: summary.manifest.name,
      version: summary.manifest.version,
      description: summary.manifest.description,
      capability,
      registry: 'installed',
      trustLevel: summary.trustLevel,
      publisherVerified: summary.manifest.publisher.verified,
      compatible: true,
      installed: true,
      running: summary.running,
      hasUpdate: summary.hasUpdate,
      ...permissionSummary(summary.manifest.permissions),
      manifest: summary.manifest,
      score: scored.score + 4 + (summary.running ? 6 : 0),
      matchedTerms: scored.matched,
    });
  }

  return Array.from(byId.values())
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }

      return a.pluginName.localeCompare(b.pluginName);
    })
    .slice(0, limit);
}

function dependencyInfo(
  dependency: PluginDependency,
  registry: RegistryLike,
  seen: Set<string>
): { ok: true; dependency: DemandDependency } | { ok: false; error: string } {
  const summaries = registry.getSummaries();
  const catalog = registry.getCatalogEntries();
  const installed = summaries.find(
    (summary) => summary.manifest.pluginId === dependency.pluginId
  );
  const entry = catalog.find((item) => item.manifest.pluginId === dependency.pluginId);
  const installedManifest = installed?.manifest ?? null;
  const catalogManifest =
    entry && entry.trustLevel !== 'untrusted' ? entry.manifest : null;
  const installedSatisfies = installedManifest
    ? satisfiesRange(installedManifest.version, dependency.version)
    : false;
  const catalogSatisfies = catalogManifest
    ? satisfiesRange(catalogManifest.version, dependency.version)
    : false;

  let manifest: PluginManifest | null = null;
  let requiresUpdate = false;

  if (installedSatisfies && installedManifest) {
    manifest = installedManifest;
  } else if (catalogSatisfies && catalogManifest) {
    manifest = catalogManifest;
    requiresUpdate = Boolean(installed && isInstalledStatus(installed.status));
  } else if (installedManifest || catalogManifest) {
    const version = catalogManifest?.version ?? installedManifest?.version;

    return {
      ok: false,
      error: `Dependency "${dependency.pluginId}" ${version} does not satisfy ${dependency.version}.`,
    };
  } else {
    return {
      ok: false,
      error: `Required dependency "${dependency.pluginId}" is not in a trusted registry.`,
    };
  }

  if (seen.has(dependency.pluginId)) {
    return {
      ok: true,
      dependency: emptyDependency(
        manifest,
        installed?.status ?? 'available',
        requiresUpdate
      ),
    };
  }

  seen.add(dependency.pluginId);

  for (const nested of manifest.dependencies) {
    const result = dependencyInfo(nested, registry, seen);

    if (!result.ok) {
      return result;
    }
  }

  return {
    ok: true,
    dependency: {
      pluginId: dependency.pluginId,
      name: manifest.name,
      version: manifest.version,
      status: installed?.status ?? 'available',
      installed: Boolean(installed && isInstalledStatus(installed.status)),
      running: installed?.running ?? false,
      requiresUpdate,
      permissions: manifest.permissions,
      sensitivePermissions: manifest.permissions.filter(isSensitivePermission),
      manifest,
      updateManifest: requiresUpdate ? manifest : null,
    },
  };
}

function emptyDependency(
  manifest: PluginManifest,
  status: PluginStatus,
  requiresUpdate = false
): DemandDependency {
  return {
    pluginId: manifest.pluginId,
    name: manifest.name,
    version: manifest.version,
    status,
    installed: true,
    running: false,
    requiresUpdate,
    permissions: manifest.permissions,
    sensitivePermissions: manifest.permissions.filter(isSensitivePermission),
    manifest,
    updateManifest: requiresUpdate ? manifest : null,
  };
}

/**
 * Read-only package facts for the install dialog and history. They come from
 * the already validated manifest and registry records; nothing is fetched or
 * executed while inspecting.
 */
function inspectionFor(input: {
  manifest: PluginManifest;
  candidate: DemandCandidate;
  permissions: PluginPermission[];
  sensitivePermissions: PluginPermission[];
  dependencies: DemandDependency[];
  requiresSandbox: boolean;
}): PluginInstallInspection {
  const { manifest, candidate, dependencies } = input;
  const warnings: string[] = [];

  if (!candidate.compatible) {
    warnings.push('This plugin is not compatible with this ORBIT version or platform.');
  }

  if (input.permissions.length > 0) {
    warnings.push(
      `Access is limited to the ${input.permissions.length} listed permission(s).`
    );
  }

  if (input.sensitivePermissions.length > 0) {
    warnings.push(
      `Sensitive access: ${input.sensitivePermissions
        .map((permission) => PLUGIN_PERMISSION_META[permission].label)
        .join(', ')}.`
    );
  }

  if (dependencies.some((dependency) => dependency.requiresUpdate)) {
    warnings.push('A required dependency will be updated before activation.');
  }

  if (input.requiresSandbox) {
    warnings.push('Each sandbox run still needs its own approval.');
  }

  if (candidate.registry === 'configured-mcp') {
    warnings.push('This is a server configured on this device; no code is downloaded.');
  }

  return {
    pluginId: manifest.pluginId,
    pluginName: manifest.name,
    version: manifest.version,
    publisherId: manifest.publisher.id.slice(0, 120),
    publisherName: manifest.publisher.name.slice(0, 120),
    publisherVerified: manifest.publisher.verified,
    trustLevel: candidate.trustLevel,
    registry: candidate.registry,
    compatible: candidate.compatible,
    minimumOrbitVersion: manifest.minimumOrbitVersion,
    platformSupport: manifest.platformSupport.slice(),
    entryPointKind: manifest.entryPoint.kind,
    dependencies: dependencies.map((dependency) => ({
      pluginId: dependency.pluginId,
      name: dependency.name,
      version: dependency.version,
      installed: dependency.installed,
      running: dependency.running,
    })),
    sensitivePermissions: input.sensitivePermissions.slice(),
    requiresSandbox: input.requiresSandbox,
    warnings: warnings.slice(0, 8),
  };
}

export function buildDemandPlan(input: {
  candidate: DemandCandidate;
  capability: DemandCapability;
  mode: DemandMode;
  reason: string;
  registry: RegistryLike;
}): DemandPlanResult {
  const { candidate, capability, mode, registry } = input;
  const errors: string[] = [];
  const checked = validateManifest(candidate.manifest);

  if (!checked.ok) {
    return { ok: false, errors: checked.errors };
  }

  const manifest = checked.manifest;

  if (!candidate.compatible) {
    errors.push('This plugin is not compatible with this ORBIT version or platform.');
  }

  if (candidate.registry === 'configured-mcp') {
    if (manifest.entryPoint.kind !== 'mcp') {
      errors.push('A configured MCP candidate must use an MCP entry point.');
    }
  } else if (
    !candidate.publisherVerified ||
    (candidate.trustLevel !== 'official' && candidate.trustLevel !== 'verified')
  ) {
    errors.push('Only official or verified publishers can be installed on demand.');
  }

  if (
    manifest.entryPoint.kind === 'builtin' &&
    candidate.trustLevel !== 'official'
  ) {
    errors.push('Built-in entry points require an official publisher.');
  }

  const dependencies: DemandDependency[] = [];
  const seen = new Set<string>([manifest.pluginId]);

  for (const dependency of manifest.dependencies) {
    const result = dependencyInfo(dependency, registry, seen);

    if (!result.ok) {
      errors.push(result.error);
      continue;
    }

    if (!dependencies.some((item) => item.pluginId === result.dependency.pluginId)) {
      dependencies.push(result.dependency);
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const { permissions, sensitivePermissions } = permissionSummary(manifest.permissions);
  const requiresInstall = !candidate.installed;
  const installedRecord = candidate.installed
    ? registry.getRecord(candidate.pluginId)
    : null;
  const requiresUpdate = Boolean(
    candidate.installed &&
      candidate.hasUpdate &&
      installedRecord &&
      isValidSemver(candidate.version) &&
      isValidSemver(installedRecord.manifest.version) &&
      isVersionGreater(candidate.version, installedRecord.manifest.version)
  );
  const requiresEnable = !candidate.running;
  const steps: string[] = [];

  for (const dependency of dependencies) {
    if (!dependency.installed) {
      steps.push(`Install ${dependency.name} ${dependency.version} (required dependency).`);
    } else if (dependency.requiresUpdate) {
      steps.push(`Update ${dependency.name} to ${dependency.version} (required dependency).`);
    }
  }

  if (requiresInstall) {
    steps.push(`Install ${manifest.name} ${manifest.version} from ${candidate.registry}.`);
  } else if (requiresUpdate) {
    steps.push(
      `Update ${manifest.name} from ${installedRecord?.manifest.version} to ${manifest.version}.`
    );
  }

  if (dependencies.some((dependency) => !dependency.running)) {
    steps.push('Make required dependencies active.');
  }

  if (permissions.length > 0) {
    steps.push(
      `Grant only the listed access: ${permissions
        .map((permission) => PLUGIN_PERMISSION_META[permission].label)
        .join(', ')}.`
    );
  }

  if (requiresEnable) {
    steps.push(`Activate ${manifest.name} through the existing plugin runtime.`);
  }

  return {
    ok: true,
    plan: {
      pluginId: manifest.pluginId,
      pluginName: manifest.name,
      version: manifest.version,
      capability,
      mode,
      reason: normalizeText(input.reason, MAX_REASON_CHARS) || 'Complete the current agent task.',
      registry: candidate.registry,
      trustLevel: candidate.trustLevel,
      publisherVerified: candidate.publisherVerified,
      permissions,
      sensitivePermissions,
      dependencies,
      requiresInstall,
      requiresUpdate,
      requiresEnable,
      requiresSandbox: permissions.includes('sandbox.execute'),
      ...(requiresUpdate ? { updateManifest: manifest } : {}),
      steps,
      inspection: inspectionFor({
        manifest,
        candidate,
        permissions,
        sensitivePermissions,
        dependencies,
        requiresSandbox: permissions.includes('sandbox.execute'),
      }),
    },
  };
}

export function emptySmartPluginState(): SmartPluginState {
  return { version: 1, autoInstalled: {}, usage: [] };
}

function normalizeInspection(value: unknown): PluginInstallInspection | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const raw = value as Partial<PluginInstallInspection>;

  if (
    typeof raw.pluginId !== 'string' ||
    !raw.pluginId ||
    typeof raw.pluginName !== 'string' ||
    typeof raw.version !== 'string'
  ) {
    return null;
  }

  const asText = (item: unknown, max = 120): string =>
    typeof item === 'string' ? item.slice(0, max) : '';

  return {
    pluginId: raw.pluginId.slice(0, 120),
    pluginName: raw.pluginName.slice(0, 120),
    version: raw.version.slice(0, 40),
    publisherId: asText(raw.publisherId),
    publisherName: asText(raw.publisherName),
    publisherVerified: raw.publisherVerified === true,
    trustLevel: PLUGIN_TRUST_LEVELS.includes(raw.trustLevel as PluginTrustLevel)
      ? (raw.trustLevel as PluginTrustLevel)
      : 'community',
    registry:
      raw.registry === 'configured-mcp' ||
      raw.registry === 'bundled-catalog' ||
      raw.registry === 'installed'
        ? raw.registry
        : 'bundled-catalog',
    compatible: raw.compatible === true,
    minimumOrbitVersion: asText(raw.minimumOrbitVersion, 40),
    platformSupport: Array.isArray(raw.platformSupport)
      ? raw.platformSupport.filter((item): item is string => typeof item === 'string').slice(0, 8)
      : [],
    entryPointKind: asText(raw.entryPointKind, 20) || 'declarative',
    dependencies: Array.isArray(raw.dependencies)
      ? raw.dependencies.slice(0, 12).map((item) => ({
          pluginId: asText(item?.pluginId),
          name: asText(item?.name),
          version: asText(item?.version, 40),
          installed: item?.installed === true,
          running: item?.running === true,
        }))
      : [],
    sensitivePermissions: Array.isArray(raw.sensitivePermissions)
      ? raw.sensitivePermissions.filter((item): item is PluginPermission =>
          PLUGIN_PERMISSIONS.includes(item as PluginPermission)
        )
      : [],
    requiresSandbox: raw.requiresSandbox === true,
    warnings: Array.isArray(raw.warnings)
      ? raw.warnings
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 8)
          .map((item) => item.slice(0, 240))
      : [],
  };
}

export function normalizeSmartPluginState(value: unknown): SmartPluginState {
  const state = emptySmartPluginState();

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return state;
  }

  const raw = value as Partial<SmartPluginState>;

  if (raw.version !== 1 || !raw.autoInstalled || !Array.isArray(raw.usage)) {
    return state;
  }

  for (const [pluginId, item] of Object.entries(raw.autoInstalled)) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Partial<AutoInstalledPlugin>;

    if (
      typeof record.pluginId !== 'string' ||
      !record.pluginId ||
      typeof record.pluginName !== 'string' ||
      typeof record.version !== 'string' ||
      !DEMAND_CAPABILITIES.includes(record.capability as DemandCapability)
    ) {
      continue;
    }

    state.autoInstalled[pluginId] = {
      pluginId,
      pluginName: record.pluginName.slice(0, 120),
      version: record.version.slice(0, 40),
      capability: record.capability as DemandCapability,
      registry:
        record.registry === 'configured-mcp' ||
        record.registry === 'bundled-catalog' ||
        record.registry === 'installed'
          ? record.registry
          : 'bundled-catalog',
      installedAt: Number.isFinite(record.installedAt) ? Number(record.installedAt) : 0,
      lastUsedAt: Number.isFinite(record.lastUsedAt) ? Number(record.lastUsedAt) : 0,
      usageCount: Math.min(
        Math.max(Number.isFinite(record.usageCount) ? Number(record.usageCount) : 0, 0),
        100_000
      ),
      disabledAt:
        typeof record.disabledAt === 'number' && Number.isFinite(record.disabledAt)
          ? record.disabledAt
          : null,
    };
  }

  for (const item of raw.usage.slice(-MAX_HISTORY)) {
    if (!item || typeof item !== 'object') {
      continue;
    }

    const record = item as Partial<DemandUsageRecord>;

    if (
      typeof record.pluginId !== 'string' ||
      !record.pluginId ||
      !DEMAND_CAPABILITIES.includes(record.capability as DemandCapability) ||
      !['reused', 'installed', 'updated', 'enabled', 'denied', 'failed'].includes(
        record.status ?? ''
      )
    ) {
      continue;
    }

    const inspection = normalizeInspection(record.inspection);

    state.usage.push({
      pluginId: record.pluginId.slice(0, 120),
      capability: record.capability as DemandCapability,
      agentId: typeof record.agentId === 'string' ? record.agentId.slice(0, 120) : null,
      mode: record.mode === 'learn' || record.mode === 'auto' ? record.mode : 'agent',
      status: record.status as DemandUsageRecord['status'],
      createdAt: Number.isFinite(record.createdAt) ? Number(record.createdAt) : 0,
      ...(typeof record.requestId === 'number' && Number.isInteger(record.requestId)
        ? { requestId: record.requestId }
        : {}),
      ...(inspection ? { inspection } : {}),
    });
  }

  return state;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message.slice(0, 400)
    : 'Plugin request failed.';
}

export class SmartPluginInstaller {
  private statePromise: Promise<SmartPluginState> | null = null;

  constructor(
    private readonly options: {
      registry: RegistryLike &
        Pick<
          PluginRegistry,
          'install' | 'update' | 'enable' | 'disable' | 'approvePermissions'
        >;
      permissions: Pick<PluginPermissionManagerLike, 'missing'>;
      approvals: Pick<PluginApprovalService, 'requestInstall'>;
      storage: PluginKeyValueStorage;
      listServers?: () => Promise<McpServerConfig[]>;
      now?: () => number;
      idleMs?: number;
    }
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  async getState(): Promise<SmartPluginState> {
    this.statePromise ??= (async () => {
      const saved = await this.options.storage.get(
        DEMAND_STATE_PLUGIN_ID,
        DEMAND_STATE_KEY
      );
      return normalizeSmartPluginState(saved);
    })();

    return this.statePromise;
  }

  async listCandidates(input: {
    query?: string;
    capability?: DemandCapability;
    mode?: DemandMode;
    limit?: number;
  } = {}): Promise<DemandCandidate[]> {
    const servers = await (this.options.listServers?.() ?? Promise.resolve([]));

    return searchDemandRegistry({
      registry: this.options.registry,
      servers,
      query: input.query,
      capability: input.capability,
      mode: input.mode,
      limit: input.limit,
    });
  }

  private async saveState(state: SmartPluginState): Promise<void> {
    await this.options.storage.set(DEMAND_STATE_PLUGIN_ID, DEMAND_STATE_KEY, state);
  }

  async recordUsage(input: {
    pluginId: string;
    capability: DemandCapability;
    status: DemandUsageRecord['status'];
    mode: DemandMode;
    agentId?: string | null;
    pluginName?: string;
    version?: string;
    registry?: DemandRegistrySource;
    requestId?: number | null;
    inspection?: PluginInstallInspection | null;
  }): Promise<void> {
    const state = await this.getState();
    const now = this.now();
    state.usage.push({
      pluginId: input.pluginId,
      capability: input.capability,
      agentId: input.agentId ?? null,
      mode: input.mode,
      status: input.status,
      createdAt: now,
      ...(typeof input.requestId === 'number' ? { requestId: input.requestId } : {}),
      ...(input.inspection ? { inspection: input.inspection } : {}),
    });

    if (state.usage.length > MAX_HISTORY) {
      state.usage = state.usage.slice(-MAX_HISTORY);
    }

    const auto = state.autoInstalled[input.pluginId];

    if (auto) {
      auto.usageCount = Math.min(auto.usageCount + 1, 100_000);
      auto.lastUsedAt = now;
      auto.disabledAt = null;
    } else if (
      (input.status === 'installed' ||
        input.status === 'updated' ||
        input.status === 'enabled') &&
      input.pluginName &&
      input.version
    ) {
      state.autoInstalled[input.pluginId] = {
        pluginId: input.pluginId,
        pluginName: input.pluginName,
        version: input.version,
        capability: input.capability,
        registry: input.registry ?? 'bundled-catalog',
        installedAt: now,
        lastUsedAt: now,
        usageCount: 1,
        disabledAt: null,
      };
    }

    await this.saveState(state);
  }

  /** Removes one demand record after a manual uninstall. Never calls uninstall itself. */
  async forget(pluginId: string): Promise<void> {
    const state = await this.getState();
    delete state.autoInstalled[pluginId];
    await this.saveState(state);
  }

  /** Disables only plugins this installer auto-installed and has not used recently. */
  async disableUnused(): Promise<string[]> {
    const state = await this.getState();
    const idleMs = Math.max(this.options.idleMs ?? DEFAULT_IDLE_MS, 60_000);
    const now = this.now();
    const disabled: string[] = [];

    for (const record of Object.values(state.autoInstalled)) {
      const lastActivity = Math.max(record.lastUsedAt, record.installedAt);

      if (record.disabledAt !== null || now - lastActivity < idleMs) {
        continue;
      }

      const installed = this.options.registry.getRecord(record.pluginId);

      if (!installed || !isInstalledStatus(installed.status) || !installed.enabled) {
        continue;
      }

      try {
        await this.options.registry.disable(
          record.pluginId,
          'Automatically disabled after a period of non-use. It was not uninstalled.'
        );
        record.disabledAt = now;
        disabled.push(record.pluginId);
      } catch {
        // A failed disable is recorded by the registry and retried on the next pass.
      }
    }

    if (disabled.length > 0) {
      await this.saveState(state);
    }

    return disabled;
  }

  async resolve(request: DemandRequest): Promise<DemandResult> {
    const platform = this.options.registry;

    if (!platform) {
      return {
        ok: false,
        code: 'platform-unavailable',
        error: 'The plugin platform is still starting.',
        candidates: [],
      };
    }

    const mode = request.mode ?? 'agent';
    const task = normalizeText(request.task ?? request.reason ?? '', MAX_TASK_CHARS);
    const capabilities = request.capability
      ? [request.capability]
      : inferDemandCapabilities(task, mode);

    if (capabilities.length === 0) {
      return {
        ok: false,
        code: 'no-capability',
        error:
          'No capability was detected. Ask for a specific capability such as GitHub, documentation, testing, research, build, MCP, DSA or programming practice.',
        candidates: [],
      };
    }

    const servers = await (this.options.listServers?.() ?? Promise.resolve([]));
    const errors: string[] = [];
    const candidateNames = new Set<string>();
    let plan: DemandPlan | null = null;

    for (const capability of capabilities) {
      const candidates = searchDemandRegistry({
        registry: platform,
        servers,
        capability,
        mode,
      });

      for (const candidate of candidates) {
        candidateNames.add(candidate.pluginId);

        if (request.pluginId && request.pluginId !== candidate.pluginId) {
          continue;
        }

        if (candidate.running) {
          await this.recordUsage({
            pluginId: candidate.pluginId,
            pluginName: candidate.pluginName,
            version: candidate.version,
            capability,
            status: 'reused',
            mode,
            agentId: request.agentId,
            registry: candidate.registry,
          });

          return {
            ok: true,
            action: 'reused',
            pluginId: candidate.pluginId,
            pluginName: candidate.pluginName,
            version: candidate.version,
            capability,
            registry: candidate.registry,
            reason: `${candidate.pluginName} is already active for ${DEMAND_CAPABILITY_LABEL[capability].toLowerCase()}.`,
          };
        }

        const result = buildDemandPlan({
          candidate,
          capability,
          mode,
          reason: request.reason ?? task,
          registry: platform,
        });

        if (result.ok) {
          plan = result.plan;
          break;
        }

        errors.push(`${candidate.pluginId}: ${result.errors.join('; ')}`);
      }

      if (plan) {
        break;
      }
    }

    if (!plan) {
      return {
        ok: false,
        code: 'unavailable',
        error: errors[0] ?? 'No trusted, compatible plugin can provide that capability.',
        candidates: Array.from(candidateNames).slice(0, 12),
      };
    }

    let requestId: number | null = null;
    const approved = await this.options.approvals.requestInstall(
      {
        pluginId: plan.pluginId,
        pluginName: plan.pluginName,
        pluginVersion: plan.version,
        trustLevel: plan.trustLevel,
        capability: plan.capability,
        capabilityLabel: DEMAND_CAPABILITY_LABEL[plan.capability],
        reason: plan.reason,
        permissions: plan.permissions,
        sensitivePermissions: plan.sensitivePermissions,
        dependencies: plan.dependencies.map((dependency) => ({
          pluginId: dependency.pluginId,
          name: dependency.name,
          version: dependency.version,
          permissions: dependency.permissions,
          installed: dependency.installed,
          running: dependency.running,
        })),
        requiresSandbox: plan.requiresSandbox,
        requiresUpdate: plan.requiresUpdate,
        steps: plan.steps,
        inspection: plan.inspection,
      },
      {
        signal: request.signal,
        onRequest: (id) => {
          requestId = id;
        },
      }
    );
    const meta: DemandResultMeta = { requestId, inspection: plan.inspection };

    if (!approved) {
      const cancelled = request.signal?.aborted === true;
      await this.recordUsage({
        pluginId: plan.pluginId,
        capability: plan.capability,
        status: 'denied',
        mode,
        agentId: request.agentId,
        requestId,
        inspection: plan.inspection,
      });

      return {
        ok: false,
        code: cancelled ? 'cancelled' : 'denied',
        error: cancelled
          ? `The install request for ${plan.pluginName} was cancelled. Nothing was installed or granted.`
          : `Installation of ${plan.pluginName} was not approved. Nothing was installed or granted.`,
        candidates: [plan.pluginId],
        ...meta,
      };
    }

    const status: DemandUsageRecord['status'] = plan.requiresInstall
      ? 'installed'
      : plan.requiresUpdate
        ? 'updated'
        : 'enabled';
    const created: string[] = [];

    try {
      for (const dependency of plan.dependencies) {
        const added = await this.preparePlugin(
          dependency.pluginId,
          dependency.permissions,
          `Approved as a dependency of ${plan.pluginName}.`,
          dependency.updateManifest
        );

        if (added) {
          created.push(dependency.pluginId);
        }
      }

      const added = await this.preparePlugin(
        plan.pluginId,
        plan.permissions,
        `Approved for ${DEMAND_CAPABILITY_LABEL[plan.capability].toLowerCase()}: ${plan.reason}`,
        plan.updateManifest
      );

      if (added) {
        created.push(plan.pluginId);
      }

      await this.recordUsage({
        pluginId: plan.pluginId,
        pluginName: plan.pluginName,
        version: plan.version,
        capability: plan.capability,
        status,
        mode,
        agentId: request.agentId,
        registry: plan.registry,
        requestId,
        inspection: plan.inspection,
      });
      await this.disableUnused();

      return {
        ok: true,
        action: plan.requiresInstall
          ? 'installed'
          : plan.requiresUpdate
            ? 'updated'
            : 'enabled',
        pluginId: plan.pluginId,
        pluginName: plan.pluginName,
        version: plan.version,
        capability: plan.capability,
        registry: plan.registry,
        reason: `${plan.pluginName} was approved, ${
          plan.requiresInstall ? 'installed' : plan.requiresUpdate ? 'updated' : 'activated'
        }, and is ready for this task.`,
        ...meta,
      };
    } catch (error) {
      // Compensating action: disable only plugins this request just installed.
      // Registry updates already restore their own backups; nothing is
      // uninstalled and pre-existing plugins are never touched.
      for (const pluginId of [...created].reverse()) {
        try {
          const record = platform.getRecord(pluginId);

          if (record && isInstalledStatus(record.status) && record.enabled) {
            await platform.disable(
              pluginId,
              'Rolled back after an on-demand install failed. Nothing was uninstalled.'
            );
          }
        } catch {
          // Keep the original failure as the result; the registry audits this.
        }
      }

      await this.recordUsage({
        pluginId: plan.pluginId,
        capability: plan.capability,
        status: 'failed',
        mode,
        agentId: request.agentId,
        requestId,
        inspection: plan.inspection,
      });

      return {
        ok: false,
        code: 'install-failed',
        error: errorMessage(error),
        candidates: [plan.pluginId],
        ...meta,
      };
    }
  }

  private async preparePlugin(
    pluginId: string,
    permissions: PluginPermission[],
    reason: string,
    updateManifest?: PluginManifest | null
  ): Promise<boolean> {
    const registry = this.options.registry;
    const record = registry.getRecord(pluginId);
    const installed = record ? isInstalledStatus(record.status) : false;

    if (!installed) {
      await registry.install(pluginId, { approvePermissions: permissions });
    } else {
      if (
        updateManifest &&
        record &&
        isValidSemver(updateManifest.version) &&
        isValidSemver(record.manifest.version) &&
        isVersionGreater(updateManifest.version, record.manifest.version)
      ) {
        const added = updateManifest.permissions.filter(
          (permission) => !record.manifest.permissions.includes(permission)
        );
        await registry.update(pluginId, updateManifest, {
          approveAddedPermissions: added,
        });
      }

      const missing = this.options.permissions.missing(pluginId, permissions);

      if (missing.length > 0) {
        await registry.approvePermissions(pluginId, missing, reason);
      }
    }

    const next = registry.getRecord(pluginId);

    if (!next || !next.enabled) {
      await registry.enable(pluginId);
    }

    return !installed;
  }
}

type PluginPermissionManagerLike = {
  missing(pluginId: string, permissions: PluginPermission[]): PluginPermission[];
};
