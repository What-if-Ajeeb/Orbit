import {
  ARTIFACT_CONTENT_MAX,
  ARTIFACT_TITLE_MAX,
  ArtifactStore,
  isArtifactType,
} from '@/lib/artifacts';
import { SafetyTrash } from '@/lib/safety/trash';

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

export const FILES_PLUGIN_ID = 'orbit.builtin.files';

const READ_CONTENT_MAX = 20_000;

export const filesManifest: PluginManifest = seedPluginManifest({
  pluginId: FILES_PLUGIN_ID,
  name: 'ORBIT Files',
  version: '1.0.0',
  description:
    'User-scoped access to ORBIT artifacts and the local safety trash. It reuses ArtifactStore and SafetyTrash; it does not expose a raw filesystem API.',
  category: 'storage',
  icon: 'folder-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ['android', 'ios', 'web'],
  entryPoint: { kind: 'builtin', moduleId: 'orbit-native-files' },
  permissions: ['ai.invoke', 'files.read', 'files.write'],
  capabilities: ['storage.namespaced', 'tools.ai'],
  dependencies: [{ pluginId: 'orbit.core.tools', version: '^1.0.0' }],
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
});

const LIST_OUTPUT_SCHEMA = nativeOutputSchema({
  total: { type: 'integer' },
  files: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        type: { type: 'string' },
        version: { type: 'integer' },
        updatedAt: { type: 'integer' },
      },
      required: ['id', 'title', 'type', 'version', 'updatedAt'],
      additionalProperties: false,
    },
  },
});

const CONTENT_OUTPUT_SCHEMA = nativeOutputSchema({
  id: { type: 'string' },
  title: { type: 'string' },
  type: { type: 'string' },
  version: { type: 'integer' },
  content: { type: 'string' },
  truncated: { type: 'boolean' },
});

const MUTATION_OUTPUT_SCHEMA = nativeOutputSchema({
  id: { type: 'string' },
  version: { type: 'integer' },
  updatedAt: { type: 'integer' },
});

const TRASH_OUTPUT_SCHEMA = nativeOutputSchema({
  total: { type: 'integer' },
  items: {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        kind: { type: 'string' },
        mimeType: { type: 'string' },
        size: { type: 'integer' },
        status: { type: 'string' },
        deletedAt: { type: 'integer' },
        expiresAt: { type: 'integer' },
      },
      required: [
        'id',
        'name',
        'kind',
        'mimeType',
        'size',
        'status',
        'deletedAt',
        'expiresAt',
      ],
      additionalProperties: false,
    },
  },
});

function requireArtifactType(value: string): 'markdown' | 'html' | 'svg' | 'code' {
  if (!isArtifactType(value)) {
    throw new Error('type must be markdown, html, svg or code.');
  }
  return value;
}

const listFilesTool = nativeTool('files_list', {
  name: 'files_list',
  description: 'List the current user’s ORBIT artifacts without loading their content.',
  parameters: objectSchema(
    { limit: { type: 'integer', minimum: 1, maximum: 100 } },
    []
  ),
  outputSchema: LIST_OUTPUT_SCHEMA,
  permissions: ['files.read'],
  async execute(args, context) {
    const limit = readNumber(args, 'limit', { min: 1, max: 100 }) ?? 50;
    const files = await new ArtifactStore(context.db).list(context.userId, limit);

    return {
      total: files.length,
      files: files.map((file) => ({
        id: file.id,
        title: file.title,
        type: file.type,
        version: file.currentVersion,
        updatedAt: file.updatedAt,
      })),
    };
  },
});

const readFileTool = nativeTool('files_read', {
  name: 'files_read',
  description:
    'Read one artifact, or a specific retained version, for the current user. Content is capped to keep tool output bounded.',
  parameters: objectSchema(
    {
      id: { type: 'string', minLength: 1, maxLength: 80 },
      version: { type: 'integer', minimum: 1, maximum: 30 },
    },
    ['id']
  ),
  outputSchema: CONTENT_OUTPUT_SCHEMA,
  permissions: ['files.read'],
  async execute(args, context) {
    const id = readString(args, 'id', { required: true, maxLength: 80 })!;
    const version = readNumber(args, 'version', { min: 1, max: 30 });
    const store = new ArtifactStore(context.db);
    const detail = await store.get(context.userId, id);

    if (!detail) {
      throw new Error('Artifact not found for this user.');
    }

    let content = detail.content;
    let selectedVersion = detail.currentVersion;

    if (version !== undefined) {
      const selected = await store.getVersion(context.userId, id, version);

      if (!selected) {
        throw new Error('Artifact version not found for this user.');
      }

      content = selected.content;
      selectedVersion = selected.version;
    }

    const truncated = content.length > READ_CONTENT_MAX;

    return {
      id: detail.id,
      title: detail.title,
      type: detail.type,
      version: selectedVersion,
      content: truncated ? content.slice(0, READ_CONTENT_MAX) : content,
      truncated,
    };
  },
});

const createFileTool = nativeTool('files_create', {
  name: 'files_create',
  description:
    'Create a new ORBIT artifact for the current conversation. Requires explicit approval.',
  parameters: objectSchema(
    {
      title: { type: 'string', minLength: 1, maxLength: ARTIFACT_TITLE_MAX },
      type: { type: 'string', enum: ['markdown', 'html', 'svg', 'code'] },
      language: { type: 'string', maxLength: 40 },
      content: { type: 'string', maxLength: ARTIFACT_CONTENT_MAX },
    },
    ['title', 'type', 'content']
  ),
  outputSchema: MUTATION_OUTPUT_SCHEMA,
  permissions: ['files.write'],
  requiresApproval: true,
  async execute(args, context) {
    const title = readString(args, 'title', {
      required: true,
      maxLength: ARTIFACT_TITLE_MAX,
    })!;
    const type = requireArtifactType(readString(args, 'type', { required: true })!);
    const content = readString(args, 'content', {
      required: true,
      maxLength: ARTIFACT_CONTENT_MAX,
      trim: false,
    })!;
    const language = readString(args, 'language', { maxLength: 40 });
    const artifact = await new ArtifactStore(context.db).create(context.userId, {
      title,
      type,
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

const writeFileTool = nativeTool('files_write', {
  name: 'files_write',
  description:
    'Add a new version to an existing artifact. Requires explicit approval.',
  parameters: objectSchema(
    {
      id: { type: 'string', minLength: 1, maxLength: 80 },
      content: { type: 'string', maxLength: ARTIFACT_CONTENT_MAX },
      summary: { type: 'string', maxLength: 240 },
    },
    ['id', 'content']
  ),
  outputSchema: MUTATION_OUTPUT_SCHEMA,
  permissions: ['files.write'],
  requiresApproval: true,
  async execute(args, context) {
    const id = readString(args, 'id', { required: true, maxLength: 80 })!;
    const content = readString(args, 'content', {
      required: true,
      maxLength: ARTIFACT_CONTENT_MAX,
      trim: false,
    })!;
    const summary = readString(args, 'summary', { maxLength: 240 });
    const artifact = await new ArtifactStore(context.db).addVersion(
      context.userId,
      id,
      content,
      summary
    );

    return {
      id: artifact.id,
      version: artifact.currentVersion,
      updatedAt: artifact.updatedAt,
    };
  },
});

const restoreFileTool = nativeTool('files_restore_version', {
  name: 'files_restore_version',
  description:
    'Restore a retained artifact version as the current version. Requires explicit approval.',
  parameters: objectSchema(
    {
      id: { type: 'string', minLength: 1, maxLength: 80 },
      version: { type: 'integer', minimum: 1, maximum: 30 },
    },
    ['id', 'version']
  ),
  outputSchema: MUTATION_OUTPUT_SCHEMA,
  permissions: ['files.write'],
  requiresApproval: true,
  async execute(args, context) {
    const id = readString(args, 'id', { required: true, maxLength: 80 })!;
    const version = readNumber(args, 'version', {
      required: true,
      min: 1,
      max: 30,
    })!;
    const artifact = await new ArtifactStore(context.db).restoreVersion(
      context.userId,
      id,
      version
    );

    return {
      id: artifact.id,
      version: artifact.currentVersion,
      updatedAt: artifact.updatedAt,
    };
  },
});

const removeFileTool = nativeTool('files_remove', {
  name: 'files_remove',
  description: 'Remove one of the current user’s artifacts. Requires explicit approval.',
  parameters: objectSchema(
    { id: { type: 'string', minLength: 1, maxLength: 80 } },
    ['id']
  ),
  outputSchema: nativeOutputSchema({ removed: { type: 'boolean' } }),
  permissions: ['files.write'],
  requiresApproval: true,
  async execute(args, context) {
    const id = readString(args, 'id', { required: true, maxLength: 80 })!;
    const store = new ArtifactStore(context.db);

    if (!(await store.exists(context.userId, id))) {
      throw new Error('Artifact not found for this user.');
    }

    await store.remove(context.userId, id);
    return { removed: true };
  },
});

const listTrashTool = nativeTool('files_trash_list', {
  name: 'files_trash_list',
  description:
    'List local safety-trash items for the current user. Returns metadata only, never stored paths or bytes.',
  parameters: objectSchema({}, []),
  outputSchema: TRASH_OUTPUT_SCHEMA,
  permissions: ['files.read'],
  execute(_args, context) {
    return new SafetyTrash(context.db).list(context.userId).then((items) => ({
      total: items.length,
      items: items.map((item) => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        mimeType: item.mimeType,
        size: item.size,
        status: item.status,
        deletedAt: item.deletedAt,
        expiresAt: item.expiresAt,
      })),
    }));
  },
});

const FILES_TOOLS = [
  listFilesTool,
  readFileTool,
  createFileTool,
  writeFileTool,
  restoreFileTool,
  removeFileTool,
  listTrashTool,
];

export const filesImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.files] files plugin started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.files] files plugin stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.files] files plugin reported an error');
    },
  },
  activate(sdk) {
    for (const tool of FILES_TOOLS) {
      void sdk.tools.register(tool);
    }
  },
};
