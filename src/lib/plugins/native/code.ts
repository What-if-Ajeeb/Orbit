import {
  ARTIFACT_CONTENT_MAX,
  ArtifactStore,
} from '@/lib/artifacts';
import { listPairedDevices } from '@/lib/permissions/devices';

import { seedPluginManifest } from '../manifest-seed';
import type {
  PluginImplementation,
  PluginManifest,
} from '../types';
import {
  nativeOutputSchema,
  nativeTool,
  objectSchema,
  readNumber,
  readString,
} from './helpers';

export const CODE_PLUGIN_ID = 'orbit.builtin.code';

const READ_CONTENT_MAX = 20_000;

export const codeManifest: PluginManifest = seedPluginManifest({
  pluginId: CODE_PLUGIN_ID,
  name: 'ORBIT Code',
  version: '1.0.0',
  description:
    'Stores and reads code as versioned ORBIT artifacts and lists paired Desktop Companions. Arbitrary code execution is intentionally not provided.',
  category: 'tool',
  icon: 'code-tags-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ['android', 'ios', 'web'],
  entryPoint: { kind: 'builtin', moduleId: 'orbit-native-code' },
  permissions: ['ai.invoke', 'files.read', 'files.write'],
  capabilities: ['tools.ai', 'storage.namespaced'],
  dependencies: [{ pluginId: 'orbit.core.tools', version: '^1.0.0' }],
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
});

const CODE_OUTPUT_SCHEMA = nativeOutputSchema({
  id: { type: 'string' },
  title: { type: 'string' },
  language: { type: 'string' },
  version: { type: 'integer' },
  content: { type: 'string' },
  truncated: { type: 'boolean' },
});

const SAVE_OUTPUT_SCHEMA = nativeOutputSchema({
  id: { type: 'string' },
  version: { type: 'integer' },
  updatedAt: { type: 'integer' },
});

const DEVICES_OUTPUT_SCHEMA = nativeOutputSchema({
  total: { type: 'integer' },
  devices: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        platform: { type: 'string' },
        status: { type: 'string' },
        capabilities: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['id', 'name', 'platform', 'status', 'capabilities'],
      additionalProperties: false,
    },
  },
});

const saveCodeTool = nativeTool('code_artifact_save', {
  name: 'code_artifact_save',
  description:
    'Save source code as a versioned code artifact for the current conversation. Requires explicit approval. This stores text only; it does not execute it.',
  parameters: objectSchema(
    {
      title: { type: 'string', minLength: 1, maxLength: 80 },
      language: { type: 'string', minLength: 1, maxLength: 40 },
      content: { type: 'string', maxLength: ARTIFACT_CONTENT_MAX },
    },
    ['title', 'language', 'content']
  ),
  outputSchema: SAVE_OUTPUT_SCHEMA,
  permissions: ['files.write'],
  requiresApproval: true,
  async execute(args, context) {
    const title = readString(args, 'title', { required: true, maxLength: 80 })!;
    const language = readString(args, 'language', {
      required: true,
      maxLength: 40,
    })!;
    const content = readString(args, 'content', {
      required: true,
      maxLength: ARTIFACT_CONTENT_MAX,
      trim: false,
    })!;
    const artifact = await new ArtifactStore(context.db).create(context.userId, {
      title,
      type: 'code',
      language,
      content,
      conversationId: context.conversationId,
    });

    return {
      id: artifact.id,
      version: artifact.currentVersion,
      updatedAt: artifact.updatedAt,
    };
  },
});

const readCodeTool = nativeTool('code_artifact_read', {
  name: 'code_artifact_read',
  description:
    'Read a code artifact for the current user. Content is capped to keep tool output bounded.',
  parameters: objectSchema(
    {
      id: { type: 'string', minLength: 1, maxLength: 80 },
      version: { type: 'integer', minimum: 1, maximum: 30 },
    },
    ['id']
  ),
  outputSchema: CODE_OUTPUT_SCHEMA,
  permissions: ['files.read'],
  async execute(args, context) {
    const id = readString(args, 'id', { required: true, maxLength: 80 })!;
    const version = readNumber(args, 'version', { min: 1, max: 30 });
    const store = new ArtifactStore(context.db);
    const detail = await store.get(context.userId, id);

    if (!detail) {
      throw new Error('Code artifact not found for this user.');
    }

    if (detail.type !== 'code') {
      throw new Error('Artifact is not a code artifact.');
    }

    let content = detail.content;
    let selectedVersion = detail.currentVersion;

    if (version !== undefined) {
      const selected = await store.getVersion(context.userId, id, version);

      if (!selected) {
        throw new Error('Code artifact version not found for this user.');
      }

      content = selected.content;
      selectedVersion = selected.version;
    }

    const truncated = content.length > READ_CONTENT_MAX;

    return {
      id: detail.id,
      title: detail.title,
      language: detail.language ?? 'plain text',
      version: selectedVersion,
      content: truncated ? content.slice(0, READ_CONTENT_MAX) : content,
      truncated,
    };
  },
});

const listDevicesTool = nativeTool('code_paired_devices', {
  name: 'code_paired_devices',
  description:
    'List paired Desktop Companions without executing a command. No local shell fallback is available.',
  parameters: objectSchema({}, []),
  outputSchema: DEVICES_OUTPUT_SCHEMA,
  async execute(_args, context) {
    const devices = await listPairedDevices(context.db, context.userId);

    return {
      total: devices.length,
      devices: devices.map((device) => ({
        id: device.id,
        name: device.name,
        platform: device.platform,
        status: device.status,
        capabilities: [...device.capabilities],
      })),
    };
  },
});

export const codeImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.code] code plugin started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.code] code plugin stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.code] code plugin reported an error');
    },
  },
  activate(sdk) {
    void sdk.tools.register(saveCodeTool);
    void sdk.tools.register(readCodeTool);
    void sdk.tools.register(listDevicesTool);
  },
};
