import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';

import { permissionManager } from '../permissions/manager';
import { SafetyStore } from './store';
import { TRASH_RETENTION_MS, type TrashItem } from './types';

function stripSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function isInsideDocumentRoot(uri: string): boolean {
  const root = stripSlash(Paths.document.uri);
  return uri.startsWith(`${root}/`) && !uri.includes('..');
}

function trashRoot(): Directory {
  return new Directory(Paths.join(Paths.document.uri, 'orbit-safety'));
}

function storedRoot(): Directory {
  return new Directory(Paths.join(Paths.document.uri, 'orbit-safety', 'trash'));
}

function ensureTrashDirs(): void {
  trashRoot().create({ intermediates: true, idempotent: true });
  storedRoot().create({ intermediates: true, idempotent: true });
}

function pathMetadata(uri: string, kind: 'file' | 'folder'): {
  name: string;
  size: number;
  mimeType: string;
  metadata: TrashItem['metadata'];
} {
  if (kind === 'folder') {
    const directory = new Directory(uri);
    return {
      name: directory.name,
      size: directory.size ?? 0,
      mimeType: 'inode/directory',
      metadata: {
        kind: 'folder',
        originalPath: uri,
        createdAt: directory.info().creationTime ?? null,
        modifiedAt: directory.info().modificationTime ?? null,
      },
    };
  }

  const file = new File(uri);
  return {
    name: file.name,
    size: file.size,
    mimeType: file.type || 'application/octet-stream',
    metadata: {
      kind: 'file',
      originalPath: uri,
      createdAt: file.creationTime ?? null,
      modifiedAt: file.modificationTime ?? null,
    },
  };
}

function pathKind(uri: string): 'file' | 'folder' | null {
  const info = Paths.info(uri);
  return info.exists ? (info.isDirectory ? 'folder' : 'file') : null;
}

function sourceExists(uri: string, kind: 'file' | 'folder'): boolean {
  return pathKind(uri) === kind;
}

function deleteSource(uri: string, kind: 'file' | 'folder'): void {
  if (kind === 'folder') {
    new Directory(uri).delete();
  } else {
    new File(uri).delete();
  }
}

async function copySource(
  uri: string,
  destination: string,
  kind: 'file' | 'folder'
): Promise<void> {
  if (kind === 'folder') {
    await new Directory(uri).copy(new Directory(destination));
  } else {
    await new File(uri).copy(new File(destination));
  }
}

function copyBack(
  storedPath: string,
  originalPath: string,
  kind: 'file' | 'folder'
): Promise<void> {
  if (kind === 'folder') {
    return new Directory(storedPath).copy(new Directory(originalPath));
  }

  return new File(storedPath).copy(new File(originalPath));
}

/**
 * Real trash for app-managed files only. The file is copied into Orbit's
 private storage before the source is removed, so Restore puts the original
 bytes back at the original path. External services never enter this service.
 */
export class SafetyTrash {
  private store: SafetyStore;

  constructor(db: SQLiteDatabase) {
    this.store = new SafetyStore(db);
  }

  async trashPath(input: {
    userId: number;
    conversationId?: number | null;
    agentId: string;
    agentName?: string;
    toolName?: string;
    path: string;
    reason?: string;
  }): Promise<TrashItem> {
    const uri = input.path.trim();
    if (!uri || !isInsideDocumentRoot(uri)) {
      throw new Error(
        'Only files inside Orbit’s document folder can be moved to trash. Nothing was deleted.'
      );
    }
    const kind = pathKind(uri);
    if (!kind) {
      throw new Error('The file or folder no longer exists. Nothing was deleted.');
    }
    const info = pathMetadata(uri, kind);
    ensureTrashDirs();

    const id = `trash_${Crypto.randomUUID()}`;
    const storedPath = Paths.join(storedRoot().uri, id);
    const now = Date.now();
    const item: TrashItem = {
      id,
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      agentId: input.agentId,
      toolName: input.toolName ?? 'file_trash',
      originalPath: uri,
      storedPath,
      kind,
      name: info.name,
      size: info.size,
      mimeType: info.mimeType,
      metadata: { ...info.metadata, reason: input.reason ?? 'Agent requested trash' },
      deletedAt: now,
      expiresAt: now + TRASH_RETENTION_MS,
      restoredAt: null,
      purgedAt: null,
      status: 'trashed',
      failureReason: null,
    };

    await copySource(uri, storedPath, kind);

    try {
      deleteSource(uri, kind);
    } catch (error) {
      // Roll back the copy so the user never sees a trash entry for a file
      // that was not actually removed.
      try {
        if (kind === 'folder') {
          new Directory(storedPath).delete();
        } else {
          new File(storedPath).delete();
        }
      } catch {
        // Keep the copy if rollback fails; recovery is still possible manually.
      }
      throw error;
    }

    await this.store.insertTrash(item);
    await permissionManager.recordActivity({
      userId: input.userId,
      conversationId: item.conversationId,
      agentId: input.agentId,
      agentName: input.agentName ?? input.agentId,
      toolName: item.toolName,
      action: `Moved ${kind} to trash`,
      resourceKey: uri,
      resourceLabel: info.name,
      permissionUsed: 'file_delete',
      status: 'success',
      result: `Recoverable until ${new Date(item.expiresAt).toISOString()}`,
      category: 'file_delete',
      risk: 'high',
      reversible: true,
      metadata: { trashId: id, originalPath: uri, size: info.size },
    });

    return item;
  }

  async restore(input: {
    userId: number;
    conversationId?: number | null;
    agentId: string;
    agentName?: string;
    id?: string;
    toolName?: string;
  }): Promise<TrashItem> {
    const item = input.id
      ? await this.store.getTrash(input.userId, input.id)
      : await this.store.latestTrash(input.userId, input.conversationId ?? null);

    if (!item) {
      throw new Error('There is nothing in the trash to restore.');
    }
    if (item.status !== 'trashed') {
      throw new Error('This trash item has already been restored or purged.');
    }
    if (!isInsideDocumentRoot(item.originalPath)) {
      throw new Error('The original path is outside Orbit’s document folder. Restore was blocked.');
    }
    if (sourceExists(item.originalPath, item.kind)) {
      throw new Error('A file already exists at the original path. Restore was blocked.');
    }

    const parent = item.originalPath.slice(0, item.originalPath.lastIndexOf('/'));
    new Directory(parent).create({ intermediates: true, idempotent: true });

    await copyBack(item.storedPath, item.originalPath, item.kind);

    try {
      if (item.kind === 'folder') {
        new Directory(item.storedPath).delete();
      } else {
        new File(item.storedPath).delete();
      }
    } catch {
      // The restore succeeded; leaving the copy is safer than losing data.
    }

    const restoredAt = Date.now();
    await this.store.updateTrashStatus(
      input.userId,
      item.id,
      'restored',
      restoredAt,
      null
    );
    await permissionManager.recordActivity({
      userId: input.userId,
      conversationId: item.conversationId,
      agentId: input.agentId,
      agentName: input.agentName ?? input.agentId,
      toolName: input.toolName ?? 'file_restore',
      action: `Restored ${item.kind} from trash`,
      resourceKey: item.originalPath,
      resourceLabel: item.name,
      permissionUsed: 'file_write',
      status: 'restored',
      result: 'Original path and metadata restored.',
      category: 'file_write',
      risk: 'medium',
      reversible: true,
      metadata: { trashId: item.id, originalPath: item.originalPath },
    });

    return { ...item, status: 'restored', restoredAt };
  }

  async purgeExpired(now = Date.now()): Promise<number> {
    const expired = await this.store.listExpiredTrash(now);
    let purged = 0;

    for (const item of expired) {
      try {
        if (item.kind === 'folder') {
          new Directory(item.storedPath).delete();
        } else {
          new File(item.storedPath).delete();
        }
      } catch {
        await this.store.updateTrashStatus(
          item.userId,
          item.id,
          'failed',
          now,
          'The stored copy could not be removed.'
        );
        continue;
      }

      await this.store.updateTrashStatus(item.userId, item.id, 'purged', now);
      purged += 1;
    }

    return purged;
  }

  list(userId: number): Promise<TrashItem[]> {
    return this.store.listTrash(userId);
  }
}
