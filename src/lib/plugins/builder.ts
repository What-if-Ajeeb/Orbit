/**
 * User-authored plugin builder model.
 *
 * A builder draft is an editor document. It is converted into the canonical
 * version-1 `PluginManifest` before validation, installation or export, so the
 * app still has exactly one runtime plugin format. Draft-only fields (tags,
 * action presets, validation rules, error handling, environment references)
 * never become executable code and are never part of the installed manifest.
 *
 * Every action compiles to a data-only SandboxProgramManifest. Builder-authored
 * plugins never provide `PluginImplementation` or `PluginToolDefinition.execute`;
 * the native Rust sandbox is the only execution surface.
 */
import type { SandboxInstruction, SandboxProgramManifest } from '@/lib/sandbox/types';

import { validateJsonSchema } from './json-schema';
import {
  PLUGIN_ID_PATTERN,
  RESERVED_PLUGIN_ID_PREFIXES,
  validateManifest,
} from './manifest';
import { isValidSemver } from './semver';
import {
  PLUGIN_CAPABILITIES,
  PLUGIN_CATEGORIES,
  PLUGIN_PERMISSIONS,
  type PluginCapability,
  type PluginCategory,
  type PluginManifest,
  type PluginPermission,
  type PluginSdkToolResult,
  type PluginSettingField,
  type PluginToolDefinition,
} from './types';

export const BUILDER_DRAFT_VERSION = 1;
export const BUILDER_DRAFTS_META_KEY = 'plugin-builder.drafts.v1';
export const BUILDER_LOGS_META_KEY = 'plugin-builder.logs.v1';
export const BUILDER_MAX_LOGS = 80;
export const BUILDER_MAX_JSON_LENGTH = 12_000;

const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
const ENV_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

export const BUILDER_ICON_CHOICES = [
  'extension-puzzle-outline',
  'flash-outline',
  'hardware-chip-outline',
  'chatbubbles-outline',
  'checkmark-circle-outline',
  'bar-chart-outline',
] as const;

export const BUILDER_SANDBOX_PRESETS = ['echo', 'sum', 'concat', 'constant'] as const;
export type BuilderSandboxPreset = (typeof BUILDER_SANDBOX_PRESETS)[number];

export const BUILDER_PRESET_LABELS: Record<BuilderSandboxPreset, string> = {
  echo: 'Return a selected input field',
  sum: 'Add two numeric input fields',
  concat: 'Join a prefix with an input field',
  constant: 'Return a fixed value',
};

export type BuilderValidationRule = {
  field: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
};

export type BuilderActionHandler = {
  /** Data-only program compiled by the builder; never user-supplied JS. */
  kind: 'sandbox';
  preset: BuilderSandboxPreset;
  field?: string;
  fieldB?: string;
  prefix?: string;
  value?: string | number | boolean | null;
};

export type BuilderAction = {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  validationRules: BuilderValidationRule[];
  handler: BuilderActionHandler;
  errorHandling: {
    onError: 'fail' | 'empty';
    fallbackMessage: string;
    retryable: boolean;
  };
  permissions: PluginPermission[];
  requiresApproval: boolean;
  timeoutMs: number;
};

export type BuilderEnvironmentEntry = {
  key: string;
  /** Secret values live only in SecureStore; drafts keep the reference. */
  secret: boolean;
  /** Non-secret defaults only. Never populated for secret entries. */
  value?: string;
};

export type BuilderDraft = {
  schemaVersion: 1;
  pluginId: string;
  name: string;
  description: string;
  icon: string;
  category: PluginCategory;
  version: string;
  author: string;
  tags: string[];
  minimumOrbitVersion: string;
  capabilities: PluginCapability[];
  permissions: PluginPermission[];
  inputParameters: Record<string, unknown>;
  outputFormat: 'json' | 'text';
  settings: PluginSettingField[];
  integrations: string[];
  environment: BuilderEnvironmentEntry[];
  actions: BuilderAction[];
  preparedForPublish: boolean;
  createdAt: number;
  updatedAt: number;
};

export type BuilderLog = {
  id: string;
  pluginId: string;
  actionId: string | null;
  at: number;
  level: 'info' | 'error';
  message: string;
};

export type BuilderValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

export type SandboxToolExecutor = (
  manifest: SandboxProgramManifest,
  input: Record<string, unknown>,
  context: { signal?: AbortSignal; log: (message: string, detail?: unknown) => void }
) => Promise<PluginSdkToolResult>;

export type BuilderRuntimeOptions = {
  executor?: SandboxToolExecutor;
  hasPermission?: (permission: PluginPermission) => boolean;
  now?: () => number;
};

export type BuilderRunResult = {
  ok: boolean;
  output: unknown;
  errors: string[];
  logs: string[];
  trace: string;
  durationMs: number;
  retryable: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

  return slug || 'creator';
}

function unique<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function isPrimitive(value: unknown): boolean {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

export function createEmptyDraft(now = Date.now()): BuilderDraft {
  return {
    schemaVersion: BUILDER_DRAFT_VERSION,
    pluginId: '',
    name: '',
    description: '',
    icon: 'extension-puzzle-outline',
    category: 'tool',
    version: '1.0.0',
    author: '',
    tags: [],
    minimumOrbitVersion: '1.0.0',
    capabilities: ['ui.screens'],
    permissions: [],
    inputParameters: { type: 'object', properties: {} },
    outputFormat: 'json',
    settings: [],
    integrations: [],
    environment: [],
    actions: [],
    preparedForPublish: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function createBuilderAction(index: number): BuilderAction {
  return {
    id: `action_${index + 1}`,
    name: `Action ${index + 1}`,
    description: '',
    inputSchema: { type: 'object', properties: {} },
    outputSchema: { type: 'object', properties: {} },
    validationRules: [],
    handler: { kind: 'sandbox', preset: 'echo', field: 'value' },
    errorHandling: { onError: 'fail', fallbackMessage: '', retryable: false },
    permissions: [],
    requiresApproval: false,
    timeoutMs: 15_000,
  };
}

export function duplicateDraft(
  draft: BuilderDraft,
  pluginId: string,
  name: string,
  now = Date.now()
): BuilderDraft {
  return {
    ...JSON.parse(JSON.stringify(draft)) as BuilderDraft,
    pluginId,
    name,
    preparedForPublish: false,
    createdAt: now,
    updatedAt: now,
  };
}

/** Parses a JSON object from the builder's text fields without evaluating code. */
export function parseJsonObject(
  text: string,
  label: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (!text.trim()) {
    return { ok: true, value: {} };
  }

  if (text.length > BUILDER_MAX_JSON_LENGTH) {
    return { ok: false, error: `${label} is too large.` };
  }

  try {
    const parsed: unknown = JSON.parse(text);

    if (!isPlainObject(parsed)) {
      return { ok: false, error: `${label} must be a JSON object.` };
    }

    return { ok: true, value: parsed };
  } catch {
    return { ok: false, error: `${label} is not valid JSON.` };
  }
}

export function effectiveInputSchema(action: BuilderAction): Record<string, unknown> {
  const properties = isPlainObject(action.inputSchema.properties)
    ? { ...action.inputSchema.properties }
    : {};
  const required = Array.isArray(action.inputSchema.required)
    ? action.inputSchema.required.filter(
        (entry): entry is string => typeof entry === 'string'
      )
    : [];

  for (const rule of action.validationRules) {
    if (!rule.field) {
      continue;
    }

    const existing: Record<string, unknown> = isPlainObject(properties[rule.field])
      ? { ...(properties[rule.field] as Record<string, unknown>) }
      : { type: 'string' };

    if (rule.minLength !== undefined) existing.minLength = rule.minLength;
    if (rule.maxLength !== undefined) existing.maxLength = rule.maxLength;
    if (rule.pattern !== undefined) existing.pattern = rule.pattern;
    properties[rule.field] = existing;

    if (rule.required && !required.includes(rule.field)) {
      required.push(rule.field);
    }
  }

  return { ...action.inputSchema, type: 'object', properties, required };
}

export function requiredActionPermissions(action: BuilderAction): PluginPermission[] {
  return unique<PluginPermission>([
    'ai.invoke',
    'sandbox.execute',
    ...action.permissions,
  ]);
}

export function validateDraft(draft: BuilderDraft): BuilderValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (draft.schemaVersion !== BUILDER_DRAFT_VERSION) {
    errors.push('Unsupported builder draft version.');
  }

  if (!PLUGIN_ID_PATTERN.test(draft.pluginId)) {
    errors.push('Plugin ID must be lowercase, dot/dash separated and start with a letter.');
  } else if (
    RESERVED_PLUGIN_ID_PREFIXES.some((prefix) => draft.pluginId.startsWith(prefix))
  ) {
    errors.push('Plugin ID uses a reserved ORBIT prefix.');
  }

  if (!draft.name.trim()) errors.push('Plugin name is required.');
  if (!draft.description.trim()) errors.push('Description is required.');
  if (!draft.author.trim()) errors.push('Author is required.');
  if (!isValidSemver(draft.version)) errors.push('Version must be a semantic version.');
  if (!isValidSemver(draft.minimumOrbitVersion)) {
    errors.push('Minimum ORBIT version must be a semantic version.');
  }
  if (!PLUGIN_CATEGORIES.includes(draft.category)) errors.push('Category is invalid.');

  for (const capability of draft.capabilities) {
    if (!PLUGIN_CAPABILITIES.includes(capability)) {
      errors.push(`Unsupported capability: ${capability}.`);
    }
  }

  for (const permission of draft.permissions) {
    if (!PLUGIN_PERMISSIONS.includes(permission)) {
      errors.push(`Unsupported permission: ${permission}.`);
    }
  }

  if (!isPlainObject(draft.inputParameters)) {
    errors.push('Input parameters must be a JSON object.');
  }

  if (!['json', 'text'].includes(draft.outputFormat)) {
    errors.push('Output format is invalid.');
  }

  for (const integration of draft.integrations) {
    if (!integration.trim()) {
      errors.push('Integrations cannot be empty.');
    } else if (
      !integration.startsWith('mcp:') &&
      !PLUGIN_ID_PATTERN.test(integration)
    ) {
      errors.push(`Integration "${integration}" must be a plugin ID or mcp:<serverId>.`);
    }
  }

  for (const entry of draft.environment) {
    if (!ENV_KEY_PATTERN.test(entry.key)) {
      errors.push(`Environment key "${entry.key}" is invalid.`);
    }

    if (entry.secret && entry.value !== undefined) {
      errors.push(`Secret "${entry.key}" must not be stored in a draft.`);
    }
  }

  const actionNames = new Set<string>();

  for (const action of draft.actions) {
    if (!TOOL_NAME_PATTERN.test(action.id)) {
      errors.push(`Action ID "${action.id}" is not a valid tool name.`);
    }

    if (actionNames.has(action.id)) {
      errors.push(`Duplicate action ID "${action.id}".`);
    }
    actionNames.add(action.id);

    if (!action.name.trim() || !action.description.trim()) {
      errors.push(`Action "${action.id}" needs a name and description.`);
    }

    if (!isPlainObject(action.inputSchema)) {
      errors.push(`Input schema for "${action.id}" must be a JSON object.`);
    }

    if (!isPlainObject(action.outputSchema)) {
      errors.push(`Output schema for "${action.id}" must be a JSON object.`);
    }

    for (const rule of action.validationRules) {
      if (!rule.field) {
        errors.push(`A validation rule for "${action.id}" has no field.`);
      }

      if (rule.minLength !== undefined && rule.minLength < 0) {
        errors.push(`Validation minimum for "${rule.field}" is negative.`);
      }

      if (rule.pattern !== undefined) {
        try {
          new RegExp(rule.pattern);
        } catch {
          errors.push(`Validation pattern for "${rule.field}" is invalid.`);
        }
      }
    }

    for (const permission of action.permissions) {
      if (!PLUGIN_PERMISSIONS.includes(permission)) {
        errors.push(`Action "${action.id}" requests unknown permission "${permission}".`);
      }
    }

    if (
      !Number.isFinite(action.timeoutMs) ||
      action.timeoutMs < 1_000 ||
      action.timeoutMs > 60_000
    ) {
      errors.push(`Action "${action.id}" timeout must be between 1s and 60s.`);
    }

    const handler = action.handler;

    if (!BUILDER_SANDBOX_PRESETS.includes(handler.preset)) {
      errors.push(`Action "${action.id}" has an unsupported sandbox preset.`);
    }

    if (handler.value !== undefined && !isPrimitive(handler.value)) {
      errors.push(`Action "${action.id}" constant must be a primitive value.`);
    }
  }

  if (draft.actions.length === 0) {
    warnings.push('Add at least one action before installing the plugin.');
  }

  if (draft.permissions.length > 0) {
    warnings.push('Permissions are least-privilege by default. Review every grant before enabling.');
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Every action becomes a fixed, data-only program interpreted by Rust. */
export function buildSandboxProgram(
  draft: BuilderDraft,
  action: BuilderAction
): SandboxProgramManifest {
  const handler = action.handler;
  let instructions: SandboxInstruction[];

  switch (handler.preset) {
    case 'sum':
      instructions = [
        { op: 'load', key: 'input', field: handler.field || 'a' },
        { op: 'load', key: 'input', field: handler.fieldB || 'b' },
        { op: 'add' },
        { op: 'emit', key: 'sum' },
        { op: 'return' },
      ];
      break;
    case 'concat':
      instructions = [
        { op: 'push', value: handler.prefix ?? '' },
        { op: 'load', key: 'input', field: handler.field || 'value' },
        { op: 'concat' },
        { op: 'emit', key: 'text' },
        { op: 'return' },
      ];
      break;
    case 'constant':
      instructions = [
        { op: 'push', value: handler.value ?? null },
        { op: 'emit', key: 'value' },
        { op: 'return' },
      ];
      break;
    case 'echo':
    default:
      instructions = [
        { op: 'load', key: 'input', field: handler.field || 'value' },
        { op: 'emit', key: 'result' },
        { op: 'return' },
      ];
      break;
  }

  return {
    pluginId: draft.pluginId,
    version: draft.version,
    program: { version: 1, instructions },
  };
}

/** Converts draft-only settings into the canonical v1 plugin manifest. */
export function buildManifest(draft: BuilderDraft): PluginManifest {
  const capabilities = unique<PluginCapability>([
    ...draft.capabilities,
    ...(draft.actions.length > 0 ? (['tools.ai'] as PluginCapability[]) : []),
    ...(draft.integrations.some((entry) => entry.startsWith('mcp:'))
      ? (['integration.mcp'] as PluginCapability[])
      : []),
  ]);

  const permissions = unique<PluginPermission>([
    ...draft.permissions,
    ...(capabilities.some((capability) => capability.startsWith('ui.'))
      ? (['ui.contribute'] as PluginPermission[])
      : []),
    ...(draft.actions.length > 0 ? (['ai.invoke'] as PluginPermission[]) : []),
    ...(draft.actions.length > 0 ? (['sandbox.execute'] as PluginPermission[]) : []),
    ...(draft.integrations.some((entry) => entry.startsWith('mcp:'))
      ? (['mcp.connect'] as PluginPermission[])
      : []),
    ...(draft.environment.some((entry) => entry.secret)
      ? (['credentials.request'] as PluginPermission[])
      : []),
  ]);

  const hasUi = capabilities.includes('ui.screens') || capabilities.includes('ui.navigation');
  const routes = hasUi
    ? [{ id: 'home', screen: 'plugin-home' as const, title: draft.name || draft.pluginId }]
    : [];
  const navigationEntries =
    hasUi && capabilities.includes('ui.navigation')
      ? [
          {
            id: 'home',
            label: draft.name || draft.pluginId,
            icon: draft.icon || 'extension-puzzle-outline',
            routeId: 'home',
          },
        ]
      : [];

  const settingsSections =
    draft.settings.length > 0 && capabilities.includes('ui.settings')
      ? [{ id: 'settings', title: 'Plugin settings' }]
      : [];

  return {
    manifestVersion: 1,
    pluginId: draft.pluginId,
    name: draft.name.trim(),
    version: draft.version,
    description: draft.description.trim(),
    author: { name: draft.author.trim() },
    publisher: {
      id: `local.${slugify(draft.author || draft.name || draft.pluginId || 'creator')}`,
      name: draft.author.trim() || 'Local creator',
      verified: false,
    },
    category: draft.category,
    icon: draft.icon,
    minimumOrbitVersion: draft.minimumOrbitVersion,
    platformSupport: ['android', 'ios', 'web'],
    entryPoint: { kind: 'declarative', screen: 'plugin-home' },
    permissions,
    capabilities,
    dependencies: draft.integrations
      .filter((entry) => !entry.startsWith('mcp:'))
      .map((pluginId) => ({ pluginId, version: '>=1.0.0' })),
    optionalDependencies: [],
    routes,
    navigationEntries,
    dashboardWidgets: [],
    settingsSections,
    settingsSchema: draft.settings,
    toolbarActions: [],
    contextActions: [],
    mcpTools: draft.actions.map((action) => ({
      name: action.id,
      description: action.description.trim(),
      inputSchema: effectiveInputSchema(action),
      outputSchema: action.outputSchema,
    })),
    events: { emits: [], listens: [] },
    lifecycleHooks: [],
    dataSchemaVersion: 1,
    updatePolicy: 'manual',
  };
}

export function validateAndBuild(
  draft: BuilderDraft
): BuilderValidation & { manifest?: PluginManifest } {
  const draftValidation = validateDraft(draft);
  const warnings = [...draftValidation.warnings];

  if (!draftValidation.ok) {
    return { ok: false, errors: draftValidation.errors, warnings };
  }

  const manifest = buildManifest(draft);
  const result = validateManifest(manifest as unknown);

  for (const warning of result.warnings) {
    if (!warnings.includes(warning)) warnings.push(warning);
  }

  if (!result.ok) {
    return { ok: false, errors: result.errors, warnings };
  }

  return { ok: true, errors: [], warnings, manifest };
}

function sanitizeError(error: unknown, input: Record<string, unknown>): string {
  let message = error instanceof Error && error.message ? error.message : 'Action failed.';

  const collect = (value: unknown): void => {
    if (typeof value === 'string' && value.length >= 2) {
      message = message.split(value).join('[redacted]');
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(collect);
      return;
    }

    if (isPlainObject(value)) {
      Object.values(value).forEach(collect);
    }
  };

  collect(input);

  return message.slice(0, 300);
}

/** Runs one action through validation, permissions and the isolated sandbox. */
export async function runBuilderAction(
  draft: BuilderDraft,
  actionId: string,
  input: Record<string, unknown>,
  options: BuilderRuntimeOptions = {}
): Promise<BuilderRunResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const action = draft.actions.find((entry) => entry.id === actionId);
  const logs: string[] = [];

  if (!action) {
    return {
      ok: false,
      output: undefined,
      errors: [`Action "${actionId}" was not found.`],
      logs,
      trace: 'Builder · unknown action',
      durationMs: 0,
      retryable: false,
    };
  }

  const trace = `Builder · ${draft.pluginId}: ${action.id}`;
  const required = requiredActionPermissions(action);
  const missing = options.hasPermission
    ? required.filter((permission) => !options.hasPermission?.(permission))
    : required;

  if (missing.length > 0) {
    return {
      ok: false,
      output: action.errorHandling.onError === 'empty' ? null : undefined,
      errors: [`Missing permission: ${missing.join(', ')}.`],
      logs: [`${trace} blocked by permissions.`],
      trace,
      durationMs: 0,
      retryable: false,
    };
  }

  const validation = validateJsonSchema(input, effectiveInputSchema(action));

  if (!validation.ok) {
    return {
      ok: false,
      output: action.errorHandling.onError === 'empty' ? null : undefined,
      errors: validation.errors,
      logs: [`${trace} rejected invalid input.`],
      trace,
      durationMs: 0,
      retryable: false,
    };
  }

  if (!options.executor) {
    return {
      ok: false,
      output: action.errorHandling.onError === 'empty' ? null : undefined,
      errors: ['Sandbox execution is unavailable. Action tests require Android.'],
      logs: [`${trace} blocked: no sandbox executor.`],
      trace,
      durationMs: 0,
      retryable: false,
    };
  }

  try {
    logs.push(`${trace} submitted a data-only sandbox program.`);

    const result = await options.executor(buildSandboxProgram(draft, action), input, {
      signal: undefined,
      log: (message) => logs.push(message.slice(0, 200)),
    });

    let output: unknown;

    try {
      output = JSON.parse(result.content) as unknown;
    } catch {
      output = { text: result.content };
    }

    const outputValidation = validateJsonSchema(output, action.outputSchema);

    if (!outputValidation.ok) {
      throw new Error(`Output failed validation: ${outputValidation.errors.join(' ')}`);
    }

    logs.push(`${trace} succeeded.`);

    return {
      ok: true,
      output,
      errors: [],
      logs,
      trace,
      durationMs: Math.max(0, now() - started),
      retryable: false,
    };
  } catch (error) {
    const message = sanitizeError(error, input);
    logs.push(`${trace} failed: ${message}`);

    return {
      ok: false,
      output: action.errorHandling.onError === 'empty' ? null : undefined,
      errors: [message],
      logs,
      trace,
      durationMs: Math.max(0, now() - started),
      retryable: action.errorHandling.retryable,
    };
  }
}

/** Definitions for `platform.registry.registerTool()`: program-only, no host code. */
export function buildToolDefinitions(draft: BuilderDraft): PluginToolDefinition[] {
  return draft.actions.map((action) => ({
    name: action.id,
    description: action.description,
    parameters: effectiveInputSchema(action) as PluginToolDefinition['parameters'],
    outputSchema: action.outputSchema,
    permissions: requiredActionPermissions(action),
    requiresApproval: action.requiresApproval,
    timeoutMs: action.timeoutMs,
    program: buildSandboxProgram(draft, action),
  }));
}
