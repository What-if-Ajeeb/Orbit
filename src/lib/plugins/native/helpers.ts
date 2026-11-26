import type { SQLiteDatabase } from 'expo-sqlite';

import { errorMessage } from '../async';
import type {
  PluginSdkToolContext,
  PluginSdkToolResult,
  PluginToolDefinition,
} from '../types';
import { redactSecrets } from '@/lib/permissions/redact';

export type NativeToolContext = PluginSdkToolContext & {
  db: SQLiteDatabase;
  userId: number;
};

export type NativeToolResultData = Record<string, unknown>;

type NativeToolBody = (
  args: Record<string, unknown>,
  context: NativeToolContext
) => Promise<NativeToolResultData> | NativeToolResultData;

function requireNativeContext(context: PluginSdkToolContext): NativeToolContext {
  if (!context.db || typeof context.userId !== 'number') {
    throw new Error('Native plugin storage context is unavailable.');
  }

  return { ...context, db: context.db, userId: context.userId };
}

export function jsonResult(
  data: NativeToolResultData,
  trace: string
): PluginSdkToolResult {
  return {
    content: JSON.stringify({ ok: true, ...data }),
    trace,
  };
}

export function failResult(
  message: string,
  trace: string
): PluginSdkToolResult {
  return {
    content: JSON.stringify({ ok: false, error: redactSecrets(message) }),
    trace,
  };
}

type HostToolBody = (
  args: Record<string, unknown>,
  context: PluginSdkToolContext
) => Promise<NativeToolResultData> | NativeToolResultData;

function wrapNativeBody(
  name: string,
  definition: Omit<PluginToolDefinition, 'execute'>,
  body: (args: Record<string, unknown>, context: PluginSdkToolContext) => Promise<NativeToolResultData> | NativeToolResultData
): PluginToolDefinition {
  return {
    ...definition,
    async execute(args, context) {
      try {
        const data = await body(args, context);
        context.log(`${name} succeeded.`);
        return jsonResult(data, `Native · ${name} succeeded`);
      } catch (error) {
        context.log(`${name} failed.`, error);
        return failResult(errorMessage(error), `Native · ${name} failed`);
      }
    },
  };
}

/**
 * Builds a reviewed built-in tool definition that needs the shared DB and user
 * scope. Tool bodies return plain data; the wrapper owns JSON serialization,
 * redacted errors and execution logging.
 */
export function nativeTool(
  name: string,
  definition: Omit<PluginToolDefinition, 'execute'> & { execute: NativeToolBody }
): PluginToolDefinition {
  const { execute, ...rest } = definition;

  return wrapNativeBody(name, rest, (args, context) =>
    execute(args, requireNativeContext(context))
  );
}

/** Builds a reviewed built-in tool definition that needs no DB context. */
export function nativeHostTool(
  name: string,
  definition: Omit<PluginToolDefinition, 'execute'> & { execute: HostToolBody }
): PluginToolDefinition {
  const { execute, ...rest } = definition;
  return wrapNativeBody(name, rest, execute);
}

export function readString(
  args: Record<string, unknown>,
  key: string,
  options: { required?: boolean; maxLength?: number; trim?: boolean } = {}
): string | undefined {
  const value = args[key];

  if (value === undefined) {
    if (options.required) {
      throw new Error(`Missing required argument: ${key}.`);
    }
    return undefined;
  }

  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string.`);
  }

  const normalized = options.trim === false ? value : value.trim();

  if (options.required && normalized.length === 0) {
    throw new Error(`${key} must not be empty.`);
  }

  if (options.maxLength && normalized.length > options.maxLength) {
    throw new Error(`${key} must be at most ${options.maxLength} characters.`);
  }

  return normalized;
}

export function readNumber(
  args: Record<string, unknown>,
  key: string,
  options: { required?: boolean; min?: number; max?: number } = {}
): number | undefined {
  const value = args[key];

  if (value === undefined) {
    if (options.required) {
      throw new Error(`Missing required argument: ${key}.`);
    }
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${key} must be a finite number.`);
  }

  if (options.min !== undefined && value < options.min) {
    throw new Error(`${key} must be at least ${options.min}.`);
  }

  if (options.max !== undefined && value > options.max) {
    throw new Error(`${key} must be at most ${options.max}.`);
  }

  return value;
}

export function readBoolean(
  args: Record<string, unknown>,
  key: string,
  options: { required?: boolean; defaultValue?: boolean } = {}
): boolean | undefined {
  const value = args[key];

  if (value === undefined) {
    if (options.required) {
      throw new Error(`Missing required argument: ${key}.`);
    }
    return options.defaultValue;
  }

  if (typeof value !== 'boolean') {
    throw new Error(`${key} must be a boolean.`);
  }

  return value;
}

export function readEnum<T extends string>(
  args: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  options: { required?: boolean; defaultValue?: T } = {}
): T | undefined {
  const value = args[key];

  if (value === undefined) {
    if (options.required) {
      throw new Error(`Missing required argument: ${key}.`);
    }
    return options.defaultValue;
  }

  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`${key} must be one of: ${allowed.join(', ')}.`);
  }

  return value as T;
}

export function objectSchema(
  properties: Record<string, unknown>,
  required: string[] = []
): PluginToolDefinition['parameters'] {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

/**
 * Output schema shared by native tools. Success fields are optional so the
 * wrapper's `{ ok: false, error }` results validate without hiding failures
 * behind a schema error.
 */
export function nativeOutputSchema(
  properties: Record<string, unknown>
): Record<string, unknown> {
  return {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      error: { type: 'string' },
      ...properties,
    },
    required: ['ok'],
    additionalProperties: false,
  };
}
