import { ArtifactStore } from '../artifacts/store';
import { isArtifactType, type ArtifactRef, type ArtifactType } from '../artifacts/types';
import { toolFail, toolOk, type AgentTool } from './tool-registry';

/** Longest content artifact_read returns to the model. */
const READ_CONTENT_MAX = 60_000;

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asInteger(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }

  return null;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'The artifact operation failed.';
}

/**
 * Extracts the ArtifactRef from a successful artifact tool result. The agent
 * loop uses it to attach references to the assistant message meta.
 */
export function parseArtifactToolRef(content: string): ArtifactRef | null {
  try {
    const parsed = JSON.parse(content) as Record<string, unknown>;

    if (
      parsed.ok !== true ||
      typeof parsed.id !== 'string' ||
      typeof parsed.title !== 'string' ||
      !isArtifactType(parsed.type)
    ) {
      return null;
    }

    const version = typeof parsed.version === 'number' && parsed.version >= 1 ? parsed.version : 1;

    return { id: parsed.id, title: parsed.title, type: parsed.type, version };
  } catch {
    return null;
  }
}

function refResult(artifact: {
  id: string;
  title: string;
  type: ArtifactType;
  currentVersion: number;
}): { id: string; title: string; type: ArtifactType; version: number } {
  return {
    id: artifact.id,
    title: artifact.title,
    type: artifact.type,
    version: artifact.currentVersion,
  };
}

const artifactCreateTool: AgentTool = {
  definition: {
    name: 'artifact_create',
    description:
      'Save substantial, self-contained content as an artifact the user can keep, open, and edit later: a document (markdown), a single-file HTML page or mini-app, an SVG graphic, or a code file longer than about 20 lines. Do not use it for short answers or conversation. Reply with one or two sentences after creating; never paste the content into chat.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short title, at most 80 characters.' },
        type: { type: 'string', enum: ['markdown', 'html', 'svg', 'code'] },
        language: {
          type: 'string',
          description: 'Language label when type is code, e.g. javascript, python.',
        },
        content: { type: 'string', description: 'The complete artifact content.' },
      },
      required: ['title', 'type', 'content'],
      additionalProperties: false,
    },
  },
  async execute({ db, userId, conversationId }, args) {
    try {
      const store = new ArtifactStore(db);
      const artifact = await store.create(userId, {
        title: asString(args.title),
        type: args.type as ArtifactType,
        language: asString(args.language) || null,
        content: asString(args.content),
        conversationId: conversationId ?? null,
      });

      return {
        content: toolOk(refResult(artifact)),
        trace: `Created artifact “${artifact.title}”`,
      };
    } catch (error) {
      return { content: toolFail(errorText(error)), trace: '' };
    }
  },
};

const artifactUpdateTool: AgentTool = {
  definition: {
    name: 'artifact_update',
    description:
      'Replace the entire content of an existing artifact with new content and record a new version. Use this for rewrites; prefer artifact_edit for small changes. Never create a duplicate artifact when an id already exists.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The artifact id from artifact_create or artifact_list.' },
        content: { type: 'string', description: 'The new full content.' },
        summary: { type: 'string', description: 'Short note about what changed.' },
      },
      required: ['id', 'content'],
      additionalProperties: false,
    },
  },
  async execute({ db, userId }, args) {
    try {
      const store = new ArtifactStore(db);
      const id = asString(args.id);

      if (!id) {
        return { content: toolFail('id is required.'), trace: '' };
      }

      const artifact = await store.addVersion(userId, id, args.content, args.summary);

      return {
        content: toolOk(refResult(artifact)),
        trace: `Updated artifact “${artifact.title}” → v${artifact.currentVersion}`,
      };
    } catch (error) {
      return { content: toolFail(errorText(error)), trace: '' };
    }
  },
};

const artifactEditTool: AgentTool = {
  definition: {
    name: 'artifact_edit',
    description:
      'Apply small exact-match replacements inside an existing artifact and record a new version. Each `old` string must appear exactly once in the current content. Use this instead of artifact_update for small changes.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The artifact id.' },
        edits: {
          type: 'array',
          description: 'Exact text replacements, applied in order.',
          items: {
            type: 'object',
            properties: {
              old: { type: 'string', description: 'Exact existing text (must match once).' },
              new: { type: 'string', description: 'Replacement text.' },
            },
            required: ['old', 'new'],
            additionalProperties: false,
          },
        },
        summary: { type: 'string', description: 'Short note about what changed.' },
      },
      required: ['id', 'edits'],
      additionalProperties: false,
    },
  },
  async execute({ db, userId }, args) {
    try {
      const store = new ArtifactStore(db);
      const id = asString(args.id);

      if (!id) {
        return { content: toolFail('id is required.'), trace: '' };
      }

      const artifact = await store.applyEdits(userId, id, args.edits, args.summary);

      return {
        content: toolOk(refResult(artifact)),
        trace: `Edited artifact “${artifact.title}” → v${artifact.currentVersion}`,
      };
    } catch (error) {
      return { content: toolFail(errorText(error)), trace: '' };
    }
  },
};

const artifactReadTool: AgentTool = {
  definition: {
    name: 'artifact_read',
    description:
      'Read an existing artifact: its metadata, a page of its current content, and version history. Returns at most 60000 characters per call. Pass start from a previous next_start to read the rest, or artifact_append to continue writing without rereading everything. Call this before editing an artifact you did not create in this turn.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The artifact id.' },
        start: {
          type: 'integer',
          description: 'Character offset to read from. Defaults to 0.',
        },
        max_chars: {
          type: 'integer',
          description: `Maximum characters to return (1-${READ_CONTENT_MAX}). Defaults to ${READ_CONTENT_MAX}.`,
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  async execute({ db, userId }, args) {
    try {
      const store = new ArtifactStore(db);
      const id = asString(args.id);

      if (!id) {
        return { content: toolFail('id is required.'), trace: '' };
      }

      const artifact = await store.get(userId, id);

      if (!artifact) {
        return { content: toolFail('Artifact not found. It may have been deleted.'), trace: '' };
      }

      const totalLength = artifact.content.length;
      const start = Math.min(Math.max(asInteger(args.start) ?? 0, 0), totalLength);
      const maxChars = Math.min(Math.max(asInteger(args.max_chars) ?? READ_CONTENT_MAX, 1), READ_CONTENT_MAX);
      const end = Math.min(start + maxChars, totalLength);
      const content = artifact.content.slice(start, end);

      return {
        content: toolOk({
          id: artifact.id,
          title: artifact.title,
          type: artifact.type,
          language: artifact.language,
          version: artifact.currentVersion,
          content,
          start,
          max_chars: maxChars,
          total_length: totalLength,
          content_truncated: end < totalLength,
          next_start: end < totalLength ? end : null,
          versions: artifact.versions.map((item) => ({
            version: item.version,
            summary: item.summary,
          })),
        }),
        trace: '',
      };
    } catch (error) {
      return { content: toolFail(errorText(error)), trace: '' };
    }
  },
};

const artifactAppendTool: AgentTool = {
  definition: {
    name: 'artifact_append',
    description:
      'Append text to the end of an existing artifact and record a new version. Use this to continue a large artifact or add a section without sending the whole content again. The artifact keeps one title and type; never create a duplicate.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The artifact id.' },
        content: { type: 'string', description: 'Text to add after the current content.' },
        summary: { type: 'string', description: 'Short note about what was added.' },
      },
      required: ['id', 'content'],
      additionalProperties: false,
    },
  },
  async execute({ db, userId }, args) {
    try {
      const store = new ArtifactStore(db);
      const id = asString(args.id);

      if (!id) {
        return { content: toolFail('id is required.'), trace: '' };
      }

      const artifact = await store.append(userId, id, args.content, args.summary);

      return {
        content: toolOk(refResult(artifact)),
        trace: `Appended to artifact “${artifact.title}” → v${artifact.currentVersion}`,
      };
    } catch (error) {
      return { content: toolFail(errorText(error)), trace: '' };
    }
  },
};

const artifactListTool: AgentTool = {
  definition: {
    name: 'artifact_list',
    description:
      'List the user’s artifacts (newest first) so earlier work can be found and continued. Returns metadata only, never content.',
    parameters: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Max artifacts to return (1-100).' },
      },
      additionalProperties: false,
    },
  },
  async execute({ db, userId }, args) {
    try {
      const store = new ArtifactStore(db);
      const limit = Math.min(Math.max(asInteger(args.limit) ?? 30, 1), 100);
      const artifacts = await store.list(userId, limit);

      return {
        content: toolOk({
          count: artifacts.length,
          artifacts: artifacts.map((item) => ({
            id: item.id,
            title: item.title,
            type: item.type,
            language: item.language,
            version: item.currentVersion,
            updated_at: new Date(item.updatedAt).toISOString(),
          })),
        }),
        trace: '',
      };
    } catch (error) {
      return { content: toolFail(errorText(error)), trace: '' };
    }
  },
};

export const ARTIFACT_TOOLS: AgentTool[] = [
  artifactCreateTool,
  artifactUpdateTool,
  artifactEditTool,
  artifactReadTool,
  artifactAppendTool,
  artifactListTool,
];
