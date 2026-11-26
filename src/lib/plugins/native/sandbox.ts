import { getMobileSandboxManager } from '@/lib/sandbox/manager';
import type { SandboxProgramManifest } from '@/lib/sandbox/types';

import { seedPluginManifest } from '../manifest-seed';
import { createSandboxToolExecutor } from '../tools';
import type {
  PluginImplementation,
  PluginManifest,
} from '../types';
import {
  nativeHostTool,
  nativeOutputSchema,
  objectSchema,
  readNumber,
  readString,
} from './helpers';

export const SANDBOX_PLUGIN_ID = 'orbit.builtin.sandbox';

const MAX_INPUT_LENGTH = 2_000;
const SUPPORTED_OPERATIONS = [
  'echo',
  'add',
  'subtract',
  'multiply',
  'concat',
] as const;

type SandboxOperation = (typeof SUPPORTED_OPERATIONS)[number];

export const sandboxManifest: PluginManifest = seedPluginManifest({
  pluginId: SANDBOX_PLUGIN_ID,
  name: 'ORBIT Sandbox',
  version: '1.0.0',
  description:
    'Android-only, data-only computations in the existing isolated process. It exposes no JavaScript loader, file, network or device access and is absent on iOS and web.',
  category: 'service',
  icon: 'shield-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ['android'],
  entryPoint: { kind: 'builtin', moduleId: 'orbit-native-sandbox' },
  permissions: ['ai.invoke', 'sandbox.execute'],
  capabilities: ['tools.ai'],
  dependencies: [{ pluginId: 'orbit.core.tools', version: '^1.0.0' }],
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
});

const POLICY_OUTPUT_SCHEMA = nativeOutputSchema({
  coreVersion: { type: 'string' },
  policyVersion: { type: 'integer' },
  isolation: { type: 'string' },
  executionFormat: { type: 'string' },
  allowedOperations: {
    type: 'array',
    items: { type: 'string' },
  },
  maxInstructions: { type: 'integer' },
  maxOutputBytes: { type: 'integer' },
  sessionCount: { type: 'integer' },
  busy: { type: 'integer' },
});

const COMPUTE_OUTPUT_SCHEMA = nativeOutputSchema({
  operation: { type: 'string' },
  outputs: { type: 'object' },
  trace: { type: 'string' },
});

function readFiniteNumber(
  args: Record<string, unknown>,
  key: string
): number {
  const value = readNumber(args, key, {
    required: true,
    min: -Number.MAX_SAFE_INTEGER,
    max: Number.MAX_SAFE_INTEGER,
  })!;

  if (!Number.isSafeInteger(value)) {
    throw new Error(`${key} must be a safe integer.`);
  }

  return value;
}

function readText(args: Record<string, unknown>, key: string): string {
  return readString(args, key, {
    required: true,
    maxLength: MAX_INPUT_LENGTH,
    trim: false,
  })!;
}

function readPrimitive(
  args: Record<string, unknown>,
  key: string
): string | number | boolean {
  const value = args[key];

  if (typeof value === 'string') {
    if (value.length > MAX_INPUT_LENGTH) {
      throw new Error(`${key} must be at most ${MAX_INPUT_LENGTH} characters.`);
    }
    return value;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return readFiniteNumber(args, key);
}

function readOperation(args: Record<string, unknown>): SandboxOperation {
  const value = readString(args, 'operation', { required: true })!;

  if (!(SUPPORTED_OPERATIONS as readonly string[]).includes(value)) {
    throw new Error(
      `operation must be one of ${SUPPORTED_OPERATIONS.join(', ')}.`
    );
  }

  return value as SandboxOperation;
}

/**
 * Builds a reviewed, fixed instruction sequence. Callers supply data only; raw
 * sandbox instructions are never accepted from the tool or the agent.
 */
function buildProgram(
  operation: SandboxOperation,
  args: Record<string, unknown>
): { manifest: SandboxProgramManifest; input: Record<string, unknown> } {
  const manifest = (instructions: SandboxProgramManifest['program']['instructions']): SandboxProgramManifest => ({
    pluginId: SANDBOX_PLUGIN_ID,
    version: sandboxManifest.version,
    program: { version: 1, instructions },
  });

  switch (operation) {
    case 'echo': {
      const value = readPrimitive(args, 'value');
      return {
        manifest: manifest([
          { op: 'load', key: 'input', field: 'value' },
          { op: 'emit', key: 'value' },
          { op: 'return' },
        ]),
        input: { value },
      };
    }
    case 'add':
    case 'subtract':
    case 'multiply': {
      const left = readFiniteNumber(args, 'left');
      const right = readFiniteNumber(args, 'right');
      const op = operation === 'add' ? 'add' : operation === 'subtract' ? 'sub' : 'mul';
      return {
        manifest: manifest([
          { op: 'load', key: 'input', field: 'left' },
          { op: 'load', key: 'input', field: 'right' },
          { op: op },
          { op: 'emit', key: 'result' },
          { op: 'return' },
        ]),
        input: { left, right },
      };
    }
    case 'concat': {
      const left = readText(args, 'left');
      const right = readText(args, 'right');
      return {
        manifest: manifest([
          { op: 'load', key: 'input', field: 'left' },
          { op: 'load', key: 'input', field: 'right' },
          { op: 'concat' },
          { op: 'emit', key: 'result' },
          { op: 'return' },
        ]),
        input: { left, right },
      };
    }
  }
}

const runInSandbox = createSandboxToolExecutor();

const policyTool = nativeHostTool('sandbox_policy', {
  name: 'sandbox_policy',
  description:
    'Describe the Android isolated-process policy through the existing sandbox manager. Read-only; it does not execute a program.',
  parameters: objectSchema({}, []),
  outputSchema: POLICY_OUTPUT_SCHEMA,
  async execute() {
    const manager = getMobileSandboxManager();
    const description = await manager.initialize();

    if (
      !description ||
      description.policyVersion !== 1 ||
      !description.isolation.includes('isolated') ||
      description.executionFormat !== 'deterministic-json-program'
    ) {
      throw new Error('The sandbox security policy is unavailable or unsupported.');
    }

    const snapshot = manager.getSnapshot();

    return {
      coreVersion: description.coreVersion,
      policyVersion: description.policyVersion,
      isolation: description.isolation,
      executionFormat: description.executionFormat,
      allowedOperations: [...description.allowedOperations],
      maxInstructions: description.limits.maxInstructions,
      maxOutputBytes: description.limits.maxOutputBytes,
      sessionCount: snapshot.sessions.length,
      busy: snapshot.busy,
    };
  },
});

const computeTool = nativeHostTool('sandbox_compute', {
  name: 'sandbox_compute',
  description:
    'Run one fixed, data-only arithmetic or string program in the Android isolated process. Raw instructions, files, network and device access are not accepted. Requires a fresh sandbox approval for every call.',
  parameters: objectSchema(
    {
      operation: { type: 'string', enum: [...SUPPORTED_OPERATIONS] },
      value: { type: ['string', 'number', 'boolean'] },
      left: { type: ['string', 'number'] },
      right: { type: ['string', 'number'] },
    },
    ['operation']
  ),
  outputSchema: COMPUTE_OUTPUT_SCHEMA,
  permissions: ['sandbox.execute'],
  requiresApproval: true,
  timeoutMs: 20_000,
  async execute(args, context) {
    const operation = readOperation(args);
    const { manifest, input } = buildProgram(operation, args);
    const result = await runInSandbox(manifest, input, context);

    let outputs: unknown;

    try {
      outputs = JSON.parse(result.content) as unknown;
    } catch {
      throw new Error('Sandbox returned an unreadable result.');
    }

    if (!outputs || typeof outputs !== 'object' || Array.isArray(outputs)) {
      throw new Error('Sandbox returned an invalid result.');
    }

    const record = outputs as Record<string, unknown>;

    if (record.ok === false) {
      throw new Error(
        typeof record.error === 'string' ? record.error : 'Sandbox execution failed.'
      );
    }

    return { operation, outputs: record, trace: result.trace };
  },
});

export const sandboxImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.sandbox] sandbox plugin started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.sandbox] sandbox plugin stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.sandbox] sandbox plugin reported an error');
    },
  },
  activate(sdk) {
    void sdk.tools.register(policyTool);
    void sdk.tools.register(computeTool);
  },
};
