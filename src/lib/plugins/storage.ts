import type { PluginPersistence } from './persistence';
import { utf8ByteLength } from './persistence';
import type { PluginSettingField } from './types';

export const DEFAULT_PLUGIN_STORAGE_QUOTA_BYTES = 1024 * 1024;
export const MAX_PLUGIN_KEY_LENGTH = 128;

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const SECRET_KEY_PATTERN =
  /(secret|token|password|passwd|api[-_]?key|authorization|credential|private[-_]?key)/i;

export class PluginStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginStorageError';
  }
}

export class PluginStorageQuotaError extends PluginStorageError {
  constructor(
    public readonly pluginId: string,
    public readonly limit: number
  ) {
    super(
      `Plugin "${pluginId}" exceeded its ${Math.round(limit / 1024)} KB storage quota.`
    );
    this.name = 'PluginStorageQuotaError';
  }
}

export function isSecretSettingKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key);
}

function assertKey(key: string): void {
  if (
    key.length === 0 ||
    key.length > MAX_PLUGIN_KEY_LENGTH ||
    !KEY_PATTERN.test(key)
  ) {
    throw new PluginStorageError(
      `Storage keys must match ${KEY_PATTERN} and be at most ${MAX_PLUGIN_KEY_LENGTH} characters.`
    );
  }
}

export class PluginKeyValueStorage {
  constructor(
    private readonly persistence: PluginPersistence,
    private readonly quotaBytes = DEFAULT_PLUGIN_STORAGE_QUOTA_BYTES,
    private readonly now: () => number = () => Date.now()
  ) {}

  async get(pluginId: string, key: string): Promise<unknown | null> {
    assertKey(key);
    const record = await this.persistence.getKv(pluginId, key);

    if (!record) {
      return null;
    }

    try {
      return JSON.parse(record.value) as unknown;
    } catch {
      throw new PluginStorageError(
        `Stored value for "${key}" is not valid JSON.`
      );
    }
  }

  async set(pluginId: string, key: string, value: unknown): Promise<void> {
    assertKey(key);
    const serialized = JSON.stringify(value);

    if (serialized === undefined) {
      throw new PluginStorageError('Plugin storage values must be JSON-serializable.');
    }

    const bytes = utf8ByteLength(serialized);
    const existing = await this.persistence.getKv(pluginId, key);
    const usage = await this.persistence.kvBytes(pluginId);
    const nextUsage = usage - (existing?.bytes ?? 0) + bytes;

    if (nextUsage > this.quotaBytes) {
      throw new PluginStorageQuotaError(pluginId, this.quotaBytes);
    }

    await this.persistence.setKv({
      pluginId,
      key,
      value: serialized,
      updatedAt: this.now(),
      bytes,
    });
  }

  async delete(pluginId: string, key: string): Promise<void> {
    assertKey(key);
    await this.persistence.deleteKv(pluginId, key);
  }

  async list(pluginId: string): Promise<{ key: string; bytes: number; updatedAt: number }[]> {
    const records = await this.persistence.listKv(pluginId);
    return records.map((record) => ({
      key: record.key,
      bytes: record.bytes,
      updatedAt: record.updatedAt,
    }));
  }

  async clear(pluginId: string): Promise<void> {
    await this.persistence.clearKv(pluginId);
  }

  async usage(pluginId: string): Promise<{ bytes: number; limit: number }> {
    return {
      bytes: await this.persistence.kvBytes(pluginId),
      limit: this.quotaBytes,
    };
  }
}

export function validateSettingValue(
  field: PluginSettingField,
  value: unknown
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (field.type === 'string') {
    if (typeof value !== 'string') {
      return { ok: false, error: `${field.label} must be text.` };
    }

    if (field.required && value.trim().length === 0) {
      return { ok: false, error: `${field.label} is required.` };
    }

    return { ok: true, value };
  }

  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, error: `${field.label} must be a number.` };
    }

    if (field.minimum !== undefined && value < field.minimum) {
      return { ok: false, error: `${field.label} must be at least ${field.minimum}.` };
    }

    if (field.maximum !== undefined && value > field.maximum) {
      return { ok: false, error: `${field.label} must be at most ${field.maximum}.` };
    }

    return { ok: true, value };
  }

  if (field.type === 'boolean') {
    if (typeof value !== 'boolean') {
      return { ok: false, error: `${field.label} must be true or false.` };
    }

    return { ok: true, value };
  }

  if (
    typeof value !== 'string' ||
    !field.options.some((option) => option.value === value)
  ) {
    return { ok: false, error: `${field.label} must be one of the listed options.` };
  }

  return { ok: true, value };
}

/**
 * Applies defaults from a settings schema without overwriting stored values.
 * Settings are ordinary (non-secret) data; secret-looking keys are rejected by
 * the registry before this helper is called.
 */
export function withSettingDefaults(
  fields: readonly PluginSettingField[],
  stored: Record<string, unknown>
): Record<string, unknown> {
  const output = { ...stored };

  for (const field of fields) {
    if (output[field.key] === undefined && field.default !== undefined) {
      output[field.key] = field.default;
    }
  }

  return output;
}
