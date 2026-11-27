import { Platform } from 'react-native';

import { toolFail, toolOk, type AgentTool } from './tool-registry';
import { SafetyTrash } from '../safety/trash';
import { authorizeSandboxPath } from '../sandbox/adapters';

async function authorizeFileOperation(options: {
  operation: 'file.delete' | 'file.write';
  path: string;
  toolName: string;
}): Promise<void> {
  if (Platform.OS !== 'android') return;
  await authorizeSandboxPath(options);
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function serializeTrash(item: Awaited<ReturnType<SafetyTrash['trashPath']>>) {
  return {
    id: item.id,
    name: item.name,
    originalPath: item.originalPath,
    kind: item.kind,
    size: item.size,
    expiresAt: new Date(item.expiresAt).toISOString(),
    reversible: true,
  };
}

const trashFileTool: AgentTool = {
  meta: { source: 'builtin' },
  definition: {
    name: 'file_trash',
    description:
      'Move an ORBIT-managed file or folder to trash. This is reversible: the original path and metadata are kept for restoration.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute path inside ORBIT’s document folder.',
        },
        reason: {
          type: 'string',
          description: 'Short reason shown in the approval dialog.',
        },
      },
      required: ['path'],
      additionalProperties: false,
    },
  },
  timeoutMs: 20_000,
  async execute(context, args) {
    const path = stringArg(args.path);
    if (!path) {
      return { content: toolFail('path is required.'), trace: '' };
    }

    try {
      await authorizeFileOperation({
        operation: 'file.delete',
        path,
        toolName: 'file_trash',
      });
      const trash = new SafetyTrash(context.db);
      const item = await trash.trashPath({
        userId: context.userId,
        conversationId: context.conversationId,
        agentId: context.agent?.id ?? 'agent',
        agentName: context.agent?.name,
        toolName: 'file_trash',
        path,
        reason: stringArg(args.reason) || undefined,
      });
      return {
        content: toolOk({ trashed: serializeTrash(item) }),
        trace: `Moved “${item.name}” to trash · reversible`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not move the file to trash.';
      return { content: toolFail(message), trace: '' };
    }
  },
};

const restoreFileTool: AgentTool = {
  meta: { source: 'builtin' },
  definition: {
    name: 'file_restore',
    description:
      'Restore the most recent trashed ORBIT-managed file or folder to its original path, or restore a specific trash id.',
    parameters: {
      type: 'object',
      properties: {
        trash_id: {
          type: 'string',
          description: 'Optional trash id. The most recent item is restored when omitted.',
        },
      },
      additionalProperties: false,
    },
  },
  timeoutMs: 20_000,
  async execute(context, args) {
    try {
      const id = stringArg(args.trash_id);
      const conditions = ['user_id = ?', "status = 'trashed'"];
      const values: (string | number)[] = [context.userId];

      if (id) {
        conditions.push('id = ?');
        values.push(id);
      } else if (context.conversationId !== undefined) {
        conditions.push('conversation_id = ?');
        values.push(context.conversationId);
      }

      const row = await context.db.getFirstAsync(
        `SELECT original_path FROM trash_items
         WHERE ${conditions.join(' AND ')} ORDER BY deleted_at DESC LIMIT 1`,
        ...values
      ) as { original_path: string } | null;

      if (row) {
        await authorizeFileOperation({
          operation: 'file.write',
          path: row.original_path,
          toolName: 'file_restore',
        });
      }

      const trash = new SafetyTrash(context.db);
      const item = await trash.restore({
        userId: context.userId,
        conversationId: context.conversationId,
        agentId: context.agent?.id ?? 'agent',
        agentName: context.agent?.name,
        toolName: 'file_restore',
        id: id || undefined,
      });
      return {
        content: toolOk({
          restored: item.id,
          originalPath: item.originalPath,
          reversible: true,
        }),
        trace: `Restored “${item.name}” to its original path`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Could not restore the file.';
      return { content: toolFail(message), trace: '' };
    }
  },
};

const undoLastFileTool: AgentTool = {
  meta: { source: 'builtin' },
  definition: {
    name: 'file_undo_last',
    description: 'Undo the most recent reversible ORBIT-managed file deletion in this conversation.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  timeoutMs: 20_000,
  async execute(context) {
    return restoreFileTool.execute(context, {});
  },
};

export const FILE_SAFETY_TOOLS: AgentTool[] = [trashFileTool, restoreFileTool, undoLastFileTool];
