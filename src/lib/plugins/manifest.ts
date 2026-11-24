import {
  PLUGIN_CAPABILITIES,
  PLUGIN_CATEGORIES,
  PLUGIN_ENTRY_KINDS,
  PLUGIN_LIFECYCLE_HOOKS,
  PLUGIN_MANIFEST_VERSION,
  PLUGIN_PERMISSIONS,
  PLUGIN_PLATFORMS,
  PLUGIN_UPDATE_POLICIES,
  type PluginCategory,
  type PluginContextAction,
  type PluginDependency,
  type PluginEntryPoint,
  type PluginEventDeclaration,
  type PluginManifest,
  type PluginMcpToolDeclaration,
  type PluginSettingField,
  type PluginUpdatePolicy,
} from './types';
import { isValidRange, isValidSemver } from './semver';

export const PLUGIN_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
export const CONTRIBUTION_ID_PATTERN = /^[a-z][a-z0-9-]*$/;
export const SETTING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;
export const EVENT_NAME_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
export const RESERVED_PLUGIN_ID_PREFIXES = [
  'orbit.core.',
  'orbit.builtin.',
  'orbit.mcp.',
  'system.',
  'core.',
] as const;

const MAX_DESCRIPTION = 4_000;
const MAX_NAME = 120;
const MAX_ID = 128;

const MANIFEST_KEYS = new Set([
  'manifestVersion',
  'pluginId',
  'name',
  'version',
  'description',
  'author',
  'publisher',
  'category',
  'icon',
  'minimumOrbitVersion',
  'platformSupport',
  'entryPoint',
  'permissions',
  'capabilities',
  'dependencies',
  'optionalDependencies',
  'routes',
  'navigationEntries',
  'dashboardWidgets',
  'settingsSections',
  'settingsSchema',
  'toolbarActions',
  'contextActions',
  'mcpTools',
  'events',
  'lifecycleHooks',
  'dataSchemaVersion',
  'updatePolicy',
]);

export class ManifestValidationError extends Error {
  constructor(
    message: string,
    public readonly errors: string[]
  ) {
    super(`${message}: ${errors.join('; ')}`);
    this.name = 'ManifestValidationError';
  }
}

export type ManifestValidationResult =
  | {
      ok: true;
      manifest: PluginManifest;
      warnings: string[];
    }
  | {
      ok: false;
      errors: string[];
      warnings: string[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown, max = 400): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function pushDuplicateErrors(
  values: string[],
  label: string,
  errors: string[]
): void {
  const seen = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      errors.push(`${label} contains duplicate "${value}".`);
    }
    seen.add(value);
  }
}

function readDependencies(
  raw: Record<string, unknown>,
  key: string,
  ownerId: string,
  errors: string[]
): PluginDependency[] {
  const value = raw[key];

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array.`);
    return [];
  }

  const dependencies: PluginDependency[] = [];
  const ids = new Set<string>();

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`${key}[${index}] must be an object.`);
      return;
    }

    if (!isNonEmptyString(entry.pluginId, MAX_ID) || !PLUGIN_ID_PATTERN.test(entry.pluginId)) {
      errors.push(`${key}[${index}].pluginId is not a valid plugin id.`);
      return;
    }

    if (entry.pluginId === ownerId) {
      errors.push(`${key}[${index}] cannot depend on the plugin itself.`);
    }

    const version = entry.version;

    if (!isNonEmptyString(version, 120) || !isValidRange(version)) {
      errors.push(`${key}[${index}].version is not a valid semantic-version range.`);
    }

    if (ids.has(entry.pluginId)) {
      errors.push(`${key} contains duplicate dependency "${entry.pluginId}".`);
    }

    ids.add(entry.pluginId);
    dependencies.push({
      pluginId: entry.pluginId,
      version: String(version ?? '').trim(),
    });
  });

  return dependencies;
}

function readPlatformSupport(
  raw: Record<string, unknown>,
  errors: string[]
): PluginManifest['platformSupport'] {
  const value = raw.platformSupport;

  if (value === undefined) {
    errors.push('platformSupport is required.');
    return [];
  }

  if (!Array.isArray(value) || value.length === 0) {
    errors.push('platformSupport must be a non-empty array.');
    return [];
  }

  const platforms: PluginManifest['platformSupport'] = [];

  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || !PLUGIN_PLATFORMS.includes(entry as never)) {
      errors.push(
        `platformSupport[${index}] must be one of ${PLUGIN_PLATFORMS.join(', ')}.`
      );
      return;
    }

    platforms.push(entry as PluginManifest['platformSupport'][number]);
  });

  pushDuplicateErrors(platforms, 'platformSupport', errors);
  return platforms;
}

function readEnumArray<T extends string>(
  raw: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  errors: string[]
): T[] {
  const value = raw[key];

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array.`);
    return [];
  }

  const result: T[] = [];

  value.forEach((entry, index) => {
    if (typeof entry !== 'string' || !allowed.includes(entry as T)) {
      errors.push(`${key}[${index}] is not supported. Allowed: ${allowed.join(', ')}.`);
      return;
    }

    result.push(entry as T);
  });

  pushDuplicateErrors(result, key, errors);
  return result;
}

function readEntryPoint(
  raw: Record<string, unknown>,
  errors: string[]
): PluginEntryPoint {
  const value = raw.entryPoint;

  if (!isRecord(value)) {
    errors.push('entryPoint is required and must be an object.');
    return { kind: 'declarative' };
  }

  const kind = value.kind;

  if (typeof kind !== 'string' || !PLUGIN_ENTRY_KINDS.includes(kind as never)) {
    errors.push(`entryPoint.kind must be one of ${PLUGIN_ENTRY_KINDS.join(', ')}.`);
    return { kind: 'declarative' };
  }

  if (kind === 'builtin') {
    if (!isNonEmptyString(value.moduleId, 120) || !CONTRIBUTION_ID_PATTERN.test(value.moduleId)) {
      errors.push('entryPoint.moduleId must be a registered built-in module id.');
    }

    return {
      kind: 'builtin',
      moduleId: typeof value.moduleId === 'string' ? value.moduleId : '',
    };
  }

  if (kind === 'mcp') {
    if (value.serverId !== undefined && !isNonEmptyString(value.serverId, 120)) {
      errors.push('entryPoint.serverId must be a non-empty string when provided.');
    }

    return {
      kind: 'mcp',
      serverId: typeof value.serverId === 'string' ? value.serverId : undefined,
    };
  }

  if (value.screen !== undefined && value.screen !== 'plugin-home') {
    errors.push('entryPoint.screen only supports "plugin-home".');
  }

  return { kind: 'declarative', screen: 'plugin-home' };
}

function readRoutes(
  raw: Record<string, unknown>,
  errors: string[]
): PluginManifest['routes'] {
  const value = raw.routes;

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push('routes must be an array.');
    return [];
  }

  const routes: PluginManifest['routes'] = [];

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`routes[${index}] must be an object.`);
      return;
    }

    const id = entry.id;
    if (typeof id !== 'string' || !CONTRIBUTION_ID_PATTERN.test(id)) {
      errors.push(`routes[${index}].id is not a valid contribution id.`);
      return;
    }

    if (entry.screen !== 'plugin-home') {
      errors.push(`routes[${index}].screen must be "plugin-home".`);
    }

    if (!isNonEmptyString(entry.title, MAX_NAME)) {
      errors.push(`routes[${index}].title is required.`);
    }

    routes.push({
      id,
      screen: 'plugin-home',
      title: typeof entry.title === 'string' ? entry.title.trim() : id,
    });
  });

  pushDuplicateErrors(
    routes.map((route) => route.id),
    'routes',
    errors
  );

  return routes;
}

function readNavigationEntries(
  raw: Record<string, unknown>,
  routeIds: Set<string>,
  errors: string[]
): PluginManifest['navigationEntries'] {
  const value = raw.navigationEntries;

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push('navigationEntries must be an array.');
    return [];
  }

  const entries: PluginManifest['navigationEntries'] = [];

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`navigationEntries[${index}] must be an object.`);
      return;
    }

    const id = entry.id;
    if (typeof id !== 'string' || !CONTRIBUTION_ID_PATTERN.test(id)) {
      errors.push(`navigationEntries[${index}].id is not a valid contribution id.`);
      return;
    }

    if (!isNonEmptyString(entry.label, MAX_NAME)) {
      errors.push(`navigationEntries[${index}].label is required.`);
    }

    if (!isNonEmptyString(entry.icon, 80)) {
      errors.push(`navigationEntries[${index}].icon is required.`);
    }

    if (typeof entry.routeId !== 'string' || !routeIds.has(entry.routeId)) {
      errors.push(
        `navigationEntries[${index}].routeId must reference a route in this manifest.`
      );
    }

    if (
      entry.order !== undefined &&
      (typeof entry.order !== 'number' || !Number.isFinite(entry.order))
    ) {
      errors.push(`navigationEntries[${index}].order must be a number.`);
    }

    entries.push({
      id,
      label: typeof entry.label === 'string' ? entry.label.trim() : id,
      icon: typeof entry.icon === 'string' ? entry.icon.trim() : '',
      routeId: typeof entry.routeId === 'string' ? entry.routeId : '',
      order: typeof entry.order === 'number' ? entry.order : undefined,
    });
  });

  pushDuplicateErrors(
    entries.map((entry) => entry.id),
    'navigationEntries',
    errors
  );

  return entries;
}

function readWidgets(
  raw: Record<string, unknown>,
  errors: string[]
): PluginManifest['dashboardWidgets'] {
  const value = raw.dashboardWidgets;

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push('dashboardWidgets must be an array.');
    return [];
  }

  const widgets: PluginManifest['dashboardWidgets'] = [];

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`dashboardWidgets[${index}] must be an object.`);
      return;
    }

    if (
      typeof entry.id !== 'string' ||
      !CONTRIBUTION_ID_PATTERN.test(entry.id)
    ) {
      errors.push(`dashboardWidgets[${index}].id is not a valid contribution id.`);
      return;
    }

    if (!isNonEmptyString(entry.title, MAX_NAME)) {
      errors.push(`dashboardWidgets[${index}].title is required.`);
    }

    if (!isNonEmptyString(entry.description, MAX_DESCRIPTION)) {
      errors.push(`dashboardWidgets[${index}].description is required.`);
    }

    const size = entry.size;
    if (size !== undefined && !['small', 'medium', 'large'].includes(String(size))) {
      errors.push(`dashboardWidgets[${index}].size is invalid.`);
    }

    widgets.push({
      id: entry.id,
      title: typeof entry.title === 'string' ? entry.title.trim() : entry.id,
      description:
        typeof entry.description === 'string' ? entry.description.trim() : '',
      size: ['small', 'medium', 'large'].includes(String(size))
        ? (size as 'small' | 'medium' | 'large')
        : undefined,
    });
  });

  pushDuplicateErrors(
    widgets.map((widget) => widget.id),
    'dashboardWidgets',
    errors
  );

  return widgets;
}

function readSettingsSections(
  raw: Record<string, unknown>,
  errors: string[]
): PluginManifest['settingsSections'] {
  const value = raw.settingsSections;

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push('settingsSections must be an array.');
    return [];
  }

  const sections: PluginManifest['settingsSections'] = [];

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`settingsSections[${index}] must be an object.`);
      return;
    }

    if (
      typeof entry.id !== 'string' ||
      !CONTRIBUTION_ID_PATTERN.test(entry.id)
    ) {
      errors.push(`settingsSections[${index}].id is not a valid contribution id.`);
      return;
    }

    if (!isNonEmptyString(entry.title, MAX_NAME)) {
      errors.push(`settingsSections[${index}].title is required.`);
    }

    sections.push({
      id: entry.id,
      title: typeof entry.title === 'string' ? entry.title.trim() : entry.id,
      description:
        typeof entry.description === 'string' ? entry.description.trim() : undefined,
    });
  });

  pushDuplicateErrors(
    sections.map((section) => section.id),
    'settingsSections',
    errors
  );

  return sections;
}

function readActions(
  raw: Record<string, unknown>,
  key: 'toolbarActions' | 'contextActions',
  errors: string[]
): (PluginManifest['toolbarActions'][number] | PluginContextAction)[] {
  const value = raw[key];

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push(`${key} must be an array.`);
    return [];
  }

  const actions: (PluginManifest['toolbarActions'][number] | PluginContextAction)[] = [];

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`${key}[${index}] must be an object.`);
      return;
    }

    if (
      typeof entry.id !== 'string' ||
      !CONTRIBUTION_ID_PATTERN.test(entry.id)
    ) {
      errors.push(`${key}[${index}].id is not a valid contribution id.`);
      return;
    }

    if (!isNonEmptyString(entry.label, MAX_NAME)) {
      errors.push(`${key}[${index}].label is required.`);
    }

    if (!isNonEmptyString(entry.icon, 80)) {
      errors.push(`${key}[${index}].icon is required.`);
    }

    if (
      typeof entry.event !== 'string' ||
      !EVENT_NAME_PATTERN.test(entry.event)
    ) {
      errors.push(`${key}[${index}].event is not a valid event name.`);
    }

    if (
      key === 'contextActions' &&
      entry.context !== 'plugin-home' &&
      entry.context !== 'sidebar'
    ) {
      errors.push(`${key}[${index}].context must be "plugin-home" or "sidebar".`);
    }

    const action: PluginManifest['toolbarActions'][number] | PluginContextAction = {
      id: entry.id,
      label: typeof entry.label === 'string' ? entry.label.trim() : entry.id,
      icon: typeof entry.icon === 'string' ? entry.icon.trim() : '',
      event: typeof entry.event === 'string' ? entry.event : '',
    };

    if (key === 'contextActions') {
      (action as PluginContextAction).context =
        entry.context === 'sidebar' ? 'sidebar' : 'plugin-home';
    }

    actions.push(action);
  });

  pushDuplicateErrors(
    actions.map((action) => action.id),
    key,
    errors
  );

  return actions;
}

function readMcpTools(
  raw: Record<string, unknown>,
  errors: string[]
): PluginMcpToolDeclaration[] {
  const value = raw.mcpTools;

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push('mcpTools must be an array.');
    return [];
  }

  const tools: PluginMcpToolDeclaration[] = [];

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`mcpTools[${index}] must be an object.`);
      return;
    }

    if (
      typeof entry.name !== 'string' ||
      !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(entry.name)
    ) {
      errors.push(`mcpTools[${index}].name is invalid.`);
      return;
    }

    if (!isNonEmptyString(entry.description, 1_000)) {
      errors.push(`mcpTools[${index}].description is required.`);
    }

    if (entry.inputSchema !== undefined && !isRecord(entry.inputSchema)) {
      errors.push(`mcpTools[${index}].inputSchema must be an object.`);
    }

    if (entry.outputSchema !== undefined && !isRecord(entry.outputSchema)) {
      errors.push(`mcpTools[${index}].outputSchema must be an object.`);
    }

    tools.push({
      name: entry.name,
      description: typeof entry.description === 'string' ? entry.description : '',
      inputSchema: isRecord(entry.inputSchema) ? entry.inputSchema : undefined,
      outputSchema: isRecord(entry.outputSchema) ? entry.outputSchema : undefined,
    });
  });

  pushDuplicateErrors(
    tools.map((tool) => tool.name),
    'mcpTools',
    errors
  );

  return tools;
}

function readEvents(
  raw: Record<string, unknown>,
  errors: string[]
): PluginEventDeclaration {
  const value = raw.events;

  if (value === undefined) {
    return { emits: [], listens: [] };
  }

  if (!isRecord(value)) {
    errors.push('events must be an object.');
    return { emits: [], listens: [] };
  }

  const reads = (key: 'emits' | 'listens'): string[] => {
    if (value[key] === undefined) {
      return [];
    }

    if (!isStringArray(value[key])) {
      errors.push(`events.${key} must be an array of event names.`);
      return [];
    }

    const names = (value[key] as string[]).map((name) => name.trim());

    names.forEach((name) => {
      if (!EVENT_NAME_PATTERN.test(name)) {
        errors.push(`events.${key} contains invalid event name "${name}".`);
      }
    });

    pushDuplicateErrors(names, `events.${key}`, errors);
    return names;
  };

  return { emits: reads('emits'), listens: reads('listens') };
}

function readSettingsSchema(
  raw: Record<string, unknown>,
  errors: string[]
): PluginSettingField[] {
  const value = raw.settingsSchema;

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    errors.push('settingsSchema must be an array.');
    return [];
  }

  const fields: PluginSettingField[] = [];

  value.forEach((entry, index) => {
    if (!isRecord(entry)) {
      errors.push(`settingsSchema[${index}] must be an object.`);
      return;
    }

    if (
      typeof entry.key !== 'string' ||
      !SETTING_KEY_PATTERN.test(entry.key)
    ) {
      errors.push(`settingsSchema[${index}].key is invalid.`);
      return;
    }

    if (!isNonEmptyString(entry.label, MAX_NAME)) {
      errors.push(`settingsSchema[${index}].label is required.`);
    }

    const type = entry.type;

    if (type === 'string') {
      if (entry.default !== undefined && typeof entry.default !== 'string') {
        errors.push(`settingsSchema[${index}].default must be a string.`);
      }

      fields.push({
        key: entry.key,
        type: 'string',
        label: String(entry.label),
        description:
          typeof entry.description === 'string' ? entry.description : undefined,
        default: typeof entry.default === 'string' ? entry.default : undefined,
        required: entry.required === true,
      });
      return;
    }

    if (type === 'number') {
      if (
        entry.default !== undefined &&
        (typeof entry.default !== 'number' || !Number.isFinite(entry.default))
      ) {
        errors.push(`settingsSchema[${index}].default must be a number.`);
      }

      if (
        entry.minimum !== undefined &&
        (typeof entry.minimum !== 'number' || !Number.isFinite(entry.minimum))
      ) {
        errors.push(`settingsSchema[${index}].minimum must be a number.`);
      }

      if (
        entry.maximum !== undefined &&
        (typeof entry.maximum !== 'number' || !Number.isFinite(entry.maximum))
      ) {
        errors.push(`settingsSchema[${index}].maximum must be a number.`);
      }

      fields.push({
        key: entry.key,
        type: 'number',
        label: String(entry.label),
        description:
          typeof entry.description === 'string' ? entry.description : undefined,
        default: typeof entry.default === 'number' ? entry.default : undefined,
        minimum: typeof entry.minimum === 'number' ? entry.minimum : undefined,
        maximum: typeof entry.maximum === 'number' ? entry.maximum : undefined,
        required: entry.required === true,
      });
      return;
    }

    if (type === 'boolean') {
      if (entry.default !== undefined && typeof entry.default !== 'boolean') {
        errors.push(`settingsSchema[${index}].default must be a boolean.`);
      }

      fields.push({
        key: entry.key,
        type: 'boolean',
        label: String(entry.label),
        description:
          typeof entry.description === 'string' ? entry.description : undefined,
        default: typeof entry.default === 'boolean' ? entry.default : undefined,
        required: entry.required === true,
      });
      return;
    }

    if (type === 'select') {
      if (!Array.isArray(entry.options) || entry.options.length === 0) {
        errors.push(`settingsSchema[${index}].options must be a non-empty array.`);
        return;
      }

      const options: { value: string; label: string }[] = [];

      entry.options.forEach((option, optionIndex) => {
        if (
          !isRecord(option) ||
          typeof option.value !== 'string' ||
          !isNonEmptyString(option.label, MAX_NAME)
        ) {
          errors.push(
            `settingsSchema[${index}].options[${optionIndex}] must have a string value and label.`
          );
          return;
        }

        options.push({ value: option.value, label: option.label.trim() });
      });

      if (
        entry.default !== undefined &&
        (typeof entry.default !== 'string' ||
          !options.some((option) => option.value === entry.default))
      ) {
        errors.push(
          `settingsSchema[${index}].default must match one of the select options.`
        );
      }

      fields.push({
        key: entry.key,
        type: 'select',
        label: String(entry.label),
        description:
          typeof entry.description === 'string' ? entry.description : undefined,
        options,
        default: typeof entry.default === 'string' ? entry.default : undefined,
        required: entry.required === true,
      });
      return;
    }

    errors.push(`settingsSchema[${index}].type is invalid.`);
  });

  pushDuplicateErrors(
    fields.map((field) => field.key),
    'settingsSchema',
    errors
  );

  return fields;
}

function validateManifestShape(
  raw: unknown
): { manifest: PluginManifest | null; errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isRecord(raw)) {
    return { manifest: null, errors: ['Manifest must be a JSON object.'], warnings };
  }

  for (const key of Object.keys(raw)) {
    if (!MANIFEST_KEYS.has(key) && key !== '$schema') {
      errors.push(`Unknown manifest field "${key}".`);
    }
  }

  let manifestVersion = raw.manifestVersion;

  if (manifestVersion === undefined) {
    manifestVersion = PLUGIN_MANIFEST_VERSION;
    warnings.push('manifestVersion is missing; assuming version 1.');
  }

  if (
    typeof manifestVersion !== 'number' ||
    !Number.isInteger(manifestVersion) ||
    manifestVersion < 1
  ) {
    errors.push('manifestVersion must be a positive integer.');
  } else if (manifestVersion > PLUGIN_MANIFEST_VERSION) {
    errors.push(
      `manifestVersion ${manifestVersion} is newer than this app supports (${PLUGIN_MANIFEST_VERSION}).`
    );
  }

  if (
    typeof raw.pluginId !== 'string' ||
    raw.pluginId.length > MAX_ID ||
    !PLUGIN_ID_PATTERN.test(raw.pluginId)
  ) {
    errors.push(
      'pluginId must be lowercase, stable, dot/dash separated, and start with a letter.'
    );
  }

  if (!isNonEmptyString(raw.name, MAX_NAME)) {
    errors.push('name is required.');
  }

  if (typeof raw.version !== 'string' || !isValidSemver(raw.version)) {
    errors.push('version must be a valid semantic version (MAJOR.MINOR.PATCH).');
  }

  if (!isNonEmptyString(raw.description, MAX_DESCRIPTION)) {
    errors.push('description is required.');
  }

  const author = raw.author;
  if (!isRecord(author) || !isNonEmptyString(author.name, MAX_NAME)) {
    errors.push('author.name is required.');
  }

  const publisher = raw.publisher;
  if (!isRecord(publisher)) {
    errors.push('publisher is required.');
  } else {
    if (
      typeof publisher.id !== 'string' ||
      !PLUGIN_ID_PATTERN.test(publisher.id)
    ) {
      errors.push('publisher.id must be a valid lowercase id.');
    }
    if (!isNonEmptyString(publisher.name, MAX_NAME)) {
      errors.push('publisher.name is required.');
    }
    if (typeof publisher.verified !== 'boolean') {
      errors.push('publisher.verified must be a boolean.');
    }
  }

  if (
    typeof raw.category !== 'string' ||
    !PLUGIN_CATEGORIES.includes(raw.category as PluginCategory)
  ) {
    errors.push(`category must be one of ${PLUGIN_CATEGORIES.join(', ')}.`);
  }

  if (raw.icon !== undefined && !isNonEmptyString(raw.icon, 160)) {
    errors.push('icon must be a non-empty string when provided.');
  }

  if (
    typeof raw.minimumOrbitVersion !== 'string' ||
    !isValidSemver(raw.minimumOrbitVersion)
  ) {
    errors.push('minimumOrbitVersion must be a valid semantic version.');
  }

  const platformSupport = readPlatformSupport(raw, errors);
  const entryPoint = readEntryPoint(raw, errors);
  const permissions = readEnumArray(raw, 'permissions', PLUGIN_PERMISSIONS, errors);
  const capabilities = readEnumArray(raw, 'capabilities', PLUGIN_CAPABILITIES, errors);
  const pluginId = typeof raw.pluginId === 'string' ? raw.pluginId : '';
  const dependencies = readDependencies(raw, 'dependencies', pluginId, errors);
  const optionalDependencies = readDependencies(
    raw,
    'optionalDependencies',
    pluginId,
    errors
  );
  const routes = readRoutes(raw, errors);
  const navigationEntries = readNavigationEntries(
    raw,
    new Set(routes.map((route) => route.id)),
    errors
  );
  const dashboardWidgets = readWidgets(raw, errors);
  const settingsSections = readSettingsSections(raw, errors);
  const settingsSchema = readSettingsSchema(raw, errors);
  const toolbarActions = readActions(
    raw,
    'toolbarActions',
    errors
  ) as PluginManifest['toolbarActions'];
  const contextActions = readActions(
    raw,
    'contextActions',
    errors
  ) as PluginManifest['contextActions'];
  const mcpTools = readMcpTools(raw, errors);
  const events = readEvents(raw, errors);
  const lifecycleHooks = readEnumArray(
    raw,
    'lifecycleHooks',
    PLUGIN_LIFECYCLE_HOOKS,
    errors
  );

  const dataSchemaVersion = raw.dataSchemaVersion;
  if (
    dataSchemaVersion !== undefined &&
    (typeof dataSchemaVersion !== 'number' ||
      !Number.isInteger(dataSchemaVersion) ||
      dataSchemaVersion < 0)
  ) {
    errors.push('dataSchemaVersion must be a non-negative integer.');
  }

  const updatePolicy = raw.updatePolicy;
  if (
    updatePolicy !== undefined &&
    (typeof updatePolicy !== 'string' ||
      !PLUGIN_UPDATE_POLICIES.includes(updatePolicy as PluginUpdatePolicy))
  ) {
    errors.push(`updatePolicy must be one of ${PLUGIN_UPDATE_POLICIES.join(', ')}.`);
  }

  if (capabilities.includes('ui.navigation') && navigationEntries.length === 0) {
    warnings.push('ui.navigation capability is declared but no navigationEntries exist.');
  }

  if (permissions.includes('files.read') || permissions.includes('files.write')) {
    warnings.push(
      'files permissions are reserved declarations. The plugin SDK does not expose a file API.'
    );
  }

  if (errors.length > 0) {
    return { manifest: null, errors, warnings };
  }

  const manifest: PluginManifest = {
    manifestVersion: Number(manifestVersion),
    pluginId,
    name: String(raw.name).trim(),
    version: String(raw.version),
    description: String(raw.description).trim(),
    author: {
      name: String((raw.author as Record<string, unknown>).name).trim(),
      url:
        typeof (raw.author as Record<string, unknown>).url === 'string'
          ? ((raw.author as Record<string, unknown>).url as string)
          : undefined,
    },
    publisher: {
      id: String((raw.publisher as Record<string, unknown>).id),
      name: String((raw.publisher as Record<string, unknown>).name).trim(),
      verified: Boolean((raw.publisher as Record<string, unknown>).verified),
    },
    category: raw.category as PluginCategory,
    icon: typeof raw.icon === 'string' ? raw.icon : undefined,
    minimumOrbitVersion: String(raw.minimumOrbitVersion),
    platformSupport,
    entryPoint,
    permissions,
    capabilities,
    dependencies,
    optionalDependencies,
    routes,
    navigationEntries,
    dashboardWidgets,
    settingsSections,
    settingsSchema,
    toolbarActions,
    contextActions,
    mcpTools,
    events,
    lifecycleHooks,
    dataSchemaVersion:
      typeof dataSchemaVersion === 'number' ? dataSchemaVersion : 1,
    updatePolicy: (updatePolicy as PluginUpdatePolicy | undefined) ?? 'manual',
  };

  return { manifest, errors, warnings };
}

/**
 * Validates and normalizes an untrusted manifest. Unknown fields, malformed
 * contributions, invalid permissions, duplicate ids and bad versions are
 * rejected before the manifest reaches the registry.
 */
export function validateManifest(raw: unknown): ManifestValidationResult {
  const { manifest, errors, warnings } = validateManifestShape(raw);

  if (!manifest) {
    return { ok: false, errors, warnings };
  }

  return { ok: true, manifest, warnings };
}

export function assertValidManifest(raw: unknown): PluginManifest {
  const result = validateManifest(raw);

  if (!result.ok) {
    throw new ManifestValidationError('Invalid plugin manifest', result.errors);
  }

  return result.manifest;
}

export function isReservedPluginId(pluginId: string): boolean {
  return RESERVED_PLUGIN_ID_PREFIXES.some((prefix) => pluginId.startsWith(prefix));
}

/**
 * A manifest can only use a reserved id if the install source is the reviewed
 * built-in/official path. Untrusted manifests cannot impersonate core plugins.
 */
export function isEntryPointAllowed(
  manifest: PluginManifest,
  trustLevel: import('./types').PluginTrustLevel
): boolean {
  if (isReservedPluginId(manifest.pluginId) && trustLevel !== 'official') {
    return false;
  }

  if (manifest.entryPoint.kind === 'builtin') {
    return trustLevel === 'official';
  }

  return true;
}

export function manifestPlatformSupported(
  manifest: PluginManifest,
  platform: import('./types').PluginPlatform
): boolean {
  return manifest.platformSupport.includes(platform);
}
