/**
 * Draft and execution-log persistence for the Plugin Builder.
 *
 * Drafts are editor documents stored through the canonical PluginPersistence
 * boundary. They are normalized on every load and save: unknown fields are
 * dropped, secret values are never accepted, and unsupported enums fall back
 * to safe defaults. Nothing here introduces a second plugin store or runtime.
 */
import { redactSecrets, truncate } from '@/lib/permissions/redact';

import {
  BUILDER_DRAFTS_META_KEY,
  BUILDER_DRAFT_VERSION,
  BUILDER_LOGS_META_KEY,
  BUILDER_MAX_LOGS,
  parseJsonObject,
  type BuilderAction,
  type BuilderDraft,
  type BuilderEnvironmentEntry,
  type BuilderLog,
  type BuilderValidationRule,
} from './builder';
import { isReservedPluginId } from './manifest';
import type { PluginPersistence } from './persistence';
import {
  PLUGIN_CAPABILITIES,
  PLUGIN_CATEGORIES,
  PLUGIN_PERMISSIONS,
  type PluginCapability,
  type PluginCategory,
  type PluginPermission,
  type PluginSettingField,
} from './types';

const MAX_DRAFTS = 60;
const MAX_DRAFT_JSON = 64_000;
const MAX_LOG_MESSAGE = 300;
const MAX_ARRAY_ITEMS = 40;
const MAX_STRING = 4_000;
const ENV_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;
const SETTING_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9._-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown, fallback = '', max = MAX_STRING): string {
  return typeof value === 'string' ? value.slice(0, max) : fallback;
}

function readBool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function readFiniteNumber(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

function readStringArray(value: unknown, maxItems = MAX_ARRAY_ITEMS): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .slice(0, maxItems)
    .map((entry) => entry.slice(0, 240));
}

function readEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T
): T {
  return typeof value === 'string' && allowed.includes(value as T) ? (value as T) : fallback;
}

function readJsonObject(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    const parsed = parseJsonObject(JSON.stringify(value), 'schema');
    return parsed.ok ? parsed.value : {};
  }

  if (typeof value === 'string') {
    const parsed = parseJsonObject(value, 'schema');
    return parsed.ok ? parsed.value : {};
  }

  return {};
}

function normalizeRule(raw: unknown): BuilderValidationRule | null {
  if (!isRecord(raw)) return null;

  const field = readString(raw.field, '', 120).trim();

  if (!field) return null;

  return {
    field,
    ...(typeof raw.required === 'boolean' ? { required: raw.required } : {}),
    ...(typeof raw.minLength === 'number' && Number.isFinite(raw.minLength)
      ? { minLength: Math.max(0, Math.floor(raw.minLength)) }
      : {}),
    ...(typeof raw.maxLength === 'number' && Number.isFinite(raw.maxLength)
      ? { maxLength: Math.max(0, Math.floor(raw.maxLength)) }
      : {}),
    ...(typeof raw.pattern === 'string' ? { pattern: raw.pattern.slice(0, 240) } : {}),
  };
}

function normalizeSetting(raw: unknown): PluginSettingField | null {
  if (!isRecord(raw)) return null;

  const key = readString(raw.key, '', 120);

  if (!SETTING_KEY_PATTERN.test(key)) return null;

  const label = readString(raw.label, '', 120);

  if (!label) return null;

  const description =
    typeof raw.description === 'string' ? readString(raw.description, '', 400) : undefined;
  const required = typeof raw.required === 'boolean' ? raw.required : undefined;

  if (raw.type === 'string') {
    return {
      key,
      type: 'string',
      label,
      ...(description ? { description } : {}),
      ...(typeof raw.default === 'string' ? { default: raw.default.slice(0, 500) } : {}),
      ...(required === undefined ? {} : { required }),
    };
  }

  if (raw.type === 'number') {
    return {
      key,
      type: 'number',
      label,
      ...(description ? { description } : {}),
      ...(typeof raw.default === 'number' && Number.isFinite(raw.default)
        ? { default: raw.default }
        : {}),
      ...(typeof raw.minimum === 'number' && Number.isFinite(raw.minimum)
        ? { minimum: raw.minimum }
        : {}),
      ...(typeof raw.maximum === 'number' && Number.isFinite(raw.maximum)
        ? { maximum: raw.maximum }
        : {}),
      ...(required === undefined ? {} : { required }),
    };
  }

  if (raw.type === 'boolean') {
    return {
      key,
      type: 'boolean',
      label,
      ...(description ? { description } : {}),
      ...(typeof raw.default === 'boolean' ? { default: raw.default } : {}),
      ...(required === undefined ? {} : { required }),
    };
  }

  if (raw.type === 'select' && Array.isArray(raw.options)) {
    const options = raw.options
      .filter(isRecord)
      .map((option) => ({
        value: readString(option.value, '', 120),
        label: readString(option.label, '', 120),
      }))
      .filter((option) => option.value && option.label)
      .slice(0, 30);

    if (options.length > 0) {
      const fallback = options[0]?.value ?? '';
      return {
        key,
        type: 'select',
        label,
        options,
        ...(description ? { description } : {}),
        ...(typeof raw.default === 'string' && options.some((option) => option.value === raw.default)
          ? { default: raw.default }
          : { default: fallback }),
        ...(required === undefined ? {} : { required }),
      };
    }
  }

  return null;
}

function normalizeEnvironment(raw: unknown): BuilderEnvironmentEntry[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const entries: BuilderEnvironmentEntry[] = [];

  for (const item of raw.slice(0, MAX_ARRAY_ITEMS)) {
    if (!isRecord(item)) continue;

    const key = readString(item.key, '', 64);

    if (!ENV_KEY_PATTERN.test(key) || seen.has(key)) continue;
    seen.add(key);

    const secret = readBool(item.secret, true);

    entries.push({
      key,
      secret,
      ...(!secret && typeof item.value === 'string'
        ? { value: readString(item.value, '', 500) }
        : {}),
    });
  }

  return entries;
}

function normalizeAction(raw: unknown, index: number): BuilderAction | null {
  if (!isRecord(raw)) return null;

  const id = readString(raw.id, `action_${index + 1}`, 80).trim();

  if (!id) return null;

  const permissions = readStringArray(raw.permissions, PLUGIN_PERMISSIONS.length).filter(
    (permission): permission is PluginPermission =>
      (PLUGIN_PERMISSIONS as readonly string[]).includes(permission)
  );
  const errorHandling = isRecord(raw.errorHandling) ? raw.errorHandling : {};

  return {
    id,
    name: readString(raw.name, `Action ${index + 1}`, 120),
    description: readString(raw.description, '', 4_000),
    inputSchema: readJsonObject(raw.inputSchema),
    outputSchema: readJsonObject(raw.outputSchema),
    validationRules: Array.isArray(raw.validationRules)
      ? raw.validationRules
          .map(normalizeRule)
          .filter((rule): rule is BuilderValidationRule => rule !== null)
          .slice(0, MAX_ARRAY_ITEMS)
      : [],
    errorHandling: {
      onError: readEnum(errorHandling.onError, ['fail', 'empty'] as const, 'fail'),
      fallbackMessage: readString(errorHandling.fallbackMessage, '', 300),
      retryable: readBool(errorHandling.retryable, false),
    },
    permissions,
    requiresApproval: readBool(raw.requiresApproval, false),
    timeoutMs: readFiniteNumber(raw.timeoutMs, 15_000, 1_000, 60_000),
  };
}

/**
 * Rebuilds a draft from persisted JSON. Unknown or unsupported values are
 * dropped instead of being trusted; a null result means the record is unusable.
 */
export function normalizeDraft(raw: unknown, now = Date.now()): BuilderDraft | null {
  if (!isRecord(raw) || raw.schemaVersion !== BUILDER_DRAFT_VERSION) {
    return null;
  }

  const pluginId = readString(raw.pluginId, '', 128).trim();

  if (!pluginId) return null;

  const capabilities = readStringArray(raw.capabilities, PLUGIN_CAPABILITIES.length).filter(
    (capability): capability is PluginCapability =>
      (PLUGIN_CAPABILITIES as readonly string[]).includes(capability)
  );
  const permissions = readStringArray(raw.permissions, PLUGIN_PERMISSIONS.length).filter(
    (permission): permission is PluginPermission =>
      (PLUGIN_PERMISSIONS as readonly string[]).includes(permission)
  );

  const draft: BuilderDraft = {
    schemaVersion: BUILDER_DRAFT_VERSION,
    pluginId,
    name: readString(raw.name, pluginId, 120),
    description: readString(raw.description, '', 4_000),
    icon: readString(raw.icon, 'extension-puzzle-outline', 80),
    category: readEnum(raw.category, PLUGIN_CATEGORIES, 'tool' as PluginCategory),
    version: readString(raw.version, '1.0.0', 60),
    author: readString(raw.author, 'Local creator', 120),
    tags: readStringArray(raw.tags, 20).map((tag) => tag.slice(0, 40)),
    minimumOrbitVersion: readString(raw.minimumOrbitVersion, '1.0.0', 60),
    capabilities,
    permissions,
    inputParameters: readJsonObject(raw.inputParameters),
    outputFormat: readEnum(raw.outputFormat, ['json', 'text'] as const, 'json'),
    settings: Array.isArray(raw.settings)
      ? raw.settings
          .map(normalizeSetting)
          .filter((field): field is PluginSettingField => field !== null)
          .slice(0, MAX_ARRAY_ITEMS)
      : [],
    integrations: readStringArray(raw.integrations, 20),
    environment: normalizeEnvironment(raw.environment),
    actions: Array.isArray(raw.actions)
      ? raw.actions
          .map(normalizeAction)
          .filter((action): action is BuilderAction => action !== null)
          .slice(0, 30)
      : [],
    preparedForPublish: readBool(raw.preparedForPublish, false),
    createdAt: readFiniteNumber(raw.createdAt, now, 0, Number.MAX_SAFE_INTEGER),
    updatedAt: readFiniteNumber(raw.updatedAt, now, 0, Number.MAX_SAFE_INTEGER),
  };

  // Local drafts are always declarative. A persisted record cannot claim a
  // reserved core id or upgrade itself into a built-in/executable plugin.
  if (isReservedPluginId(pluginId)) {
    return null;
  }

  return draft;
}

function parseJsonArray<T>(raw: string | null): T[] {
  if (!raw) return [];

  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export async function loadBuilderDrafts(persistence: PluginPersistence): Promise<BuilderDraft[]> {
  const raw = await persistence.getMeta(BUILDER_DRAFTS_META_KEY);
  const now = Date.now();

  return parseJsonArray<unknown>(raw)
    .map((entry) => normalizeDraft(entry, now))
    .filter((draft): draft is BuilderDraft => draft !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getBuilderDraft(
  persistence: PluginPersistence,
  pluginId: string
): Promise<BuilderDraft | null> {
  const drafts = await loadBuilderDrafts(persistence);
  return drafts.find((draft) => draft.pluginId === pluginId) ?? null;
}

export async function saveBuilderDraft(
  persistence: PluginPersistence,
  input: BuilderDraft
): Promise<BuilderDraft> {
  const now = Date.now();
  const draft = normalizeDraft(input, now);

  if (!draft) {
    throw new Error('Draft could not be saved because its structure is invalid.');
  }

  draft.updatedAt = now;

  const existing = await loadBuilderDrafts(persistence);
  const next = [
    draft,
    ...existing.filter((entry) => entry.pluginId !== draft.pluginId),
  ].slice(0, MAX_DRAFTS);
  const json = JSON.stringify(next);

  if (json.length > MAX_DRAFT_JSON) {
    throw new Error('Draft storage is full. Remove unused drafts and try again.');
  }

  await persistence.setMeta(BUILDER_DRAFTS_META_KEY, json);
  return draft;
}

export async function deleteBuilderDraft(
  persistence: PluginPersistence,
  pluginId: string
): Promise<void> {
  const remaining = (await loadBuilderDrafts(persistence)).filter(
    (draft) => draft.pluginId !== pluginId
  );
  await persistence.setMeta(BUILDER_DRAFTS_META_KEY, JSON.stringify(remaining));
}

export async function duplicateBuilderDraft(
  persistence: PluginPersistence,
  pluginId: string,
  newPluginId: string,
  newName: string
): Promise<BuilderDraft> {
  const existing = await getBuilderDraft(persistence, pluginId);

  if (!existing) {
    throw new Error('The draft to duplicate was not found.');
  }

  const now = Date.now();
  const copy: BuilderDraft = {
    ...JSON.parse(JSON.stringify(existing)) as BuilderDraft,
    pluginId: newPluginId,
    name: newName,
    preparedForPublish: false,
    createdAt: now,
    updatedAt: now,
  };

  return saveBuilderDraft(persistence, copy);
}

export async function appendBuilderLog(
  persistence: PluginPersistence,
  input: Omit<BuilderLog, 'id' | 'at'> & { at?: number }
): Promise<BuilderLog> {
  const log: BuilderLog = {
    id: `${input.at ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    pluginId: input.pluginId,
    actionId: input.actionId,
    at: input.at ?? Date.now(),
    level: input.level,
    message: truncate(redactSecrets(input.message), MAX_LOG_MESSAGE),
  };
  const logs = await loadBuilderLogs(persistence, undefined, BUILDER_MAX_LOGS);
  await persistence.setMeta(
    BUILDER_LOGS_META_KEY,
    JSON.stringify([log, ...logs].slice(0, BUILDER_MAX_LOGS))
  );
  return log;
}

export async function loadBuilderLogs(
  persistence: PluginPersistence,
  pluginId?: string,
  limit = BUILDER_MAX_LOGS
): Promise<BuilderLog[]> {
  const raw = await persistence.getMeta(BUILDER_LOGS_META_KEY);
  const logs = parseJsonArray<BuilderLog>(raw).filter(
    (log): log is BuilderLog =>
      isRecord(log) &&
      typeof log.id === 'string' &&
      typeof log.pluginId === 'string' &&
      typeof log.message === 'string' &&
      typeof log.at === 'number' &&
      (log.level === 'info' || log.level === 'error')
  );

  return logs
    .filter((log) => !pluginId || log.pluginId === pluginId)
    .slice(0, Math.min(limit, BUILDER_MAX_LOGS));
}

export async function clearBuilderLogs(
  persistence: PluginPersistence,
  pluginId?: string
): Promise<void> {
  if (!pluginId) {
    await persistence.setMeta(BUILDER_LOGS_META_KEY, '[]');
    return;
  }

  const remaining = await loadBuilderLogs(persistence, undefined, BUILDER_MAX_LOGS);
  await persistence.setMeta(
    BUILDER_LOGS_META_KEY,
    JSON.stringify(remaining.filter((log) => log.pluginId !== pluginId))
  );
}

function builderSecretKey(pluginId: string, key: string): string {
  const storageKey = `orbit.builder.${pluginId}.${key}`;

  if (storageKey.length > 180 || !/^[A-Za-z0-9._-]+$/.test(storageKey)) {
    throw new Error('Secret reference is not a valid secure-storage key.');
  }

  return storageKey;
}

async function secureStoreModule() {
  const { Platform } = await import('react-native');

  if (Platform.OS === 'web') {
    throw new Error('Secure secret storage is available on Android and iOS only.');
  }

  return import('expo-secure-store');
}

/** Stores a builder secret in encrypted native storage, never in the draft. */
export async function storeBuilderSecret(
  pluginId: string,
  key: string,
  value: string
): Promise<void> {
  if (!ENV_KEY_PATTERN.test(key) || !value.trim()) {
    throw new Error('Enter a valid secret key and value.');
  }

  const SecureStore = await secureStoreModule();

  await SecureStore.setItemAsync(builderSecretKey(pluginId, key), value, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED,
  });
}

export async function hasBuilderSecret(pluginId: string, key: string): Promise<boolean> {
  const SecureStore = await secureStoreModule();
  const value = await SecureStore.getItemAsync(builderSecretKey(pluginId, key));
  return value !== null;
}

export async function deleteBuilderSecret(pluginId: string, key: string): Promise<void> {
  const SecureStore = await secureStoreModule();
  await SecureStore.deleteItemAsync(builderSecretKey(pluginId, key));
}
