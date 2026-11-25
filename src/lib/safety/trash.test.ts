import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQLiteDatabase } from 'expo-sqlite';

import { permissionManager } from '../permissions/manager';
import { SafetyStore } from './store';
import { SafetyTrash } from './trash';
import type { TrashItem } from './types';

type Entry = {
  kind: 'file' | 'folder';
  content: string;
  creationTime: number;
  modificationTime: number;
};

const mocks = vi.hoisted(() => {
  const entries = new Map<string, Entry>();
  const root = 'file:///orbit-documents';

  function normalize(uri: string): string {
    return uri.replace(/\/+$/, '');
  }

  function join(...parts: string[]): string {
    if (parts.length === 0) {
      return root;
    }

    return (
      normalize(parts[0]) +
      '/' +
      parts
        .slice(1)
        .map((part) => part.replace(/^\/+/, ''))
        .join('/')
    );
  }

  function info(uri: string): { exists: boolean; isDirectory: boolean } {
    const entry = entries.get(normalize(uri));
    return { exists: Boolean(entry), isDirectory: entry?.kind === 'folder' };
  }

  function setFile(uri: string, content: string, createdAt = 1_000, modifiedAt = 2_000): void {
    entries.set(normalize(uri), {
      kind: 'file',
      content,
      creationTime: createdAt,
      modificationTime: modifiedAt,
    });
  }

  function setFolder(uri: string, createdAt = 1_000, modifiedAt = 2_000): void {
    entries.set(normalize(uri), {
      kind: 'folder',
      content: '',
      creationTime: createdAt,
      modificationTime: modifiedAt,
    });
  }

  return {
    root,
    entries,
    normalize,
    join,
    info,
    setFile,
    setFolder,
    exists: (uri: string) => entries.has(normalize(uri)),
    read: (uri: string) => entries.get(normalize(uri))?.content ?? null,
  };
});

vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));

vi.mock('expo-file-system', () => ({
  Paths: {
    document: { uri: mocks.root },
    join: (...parts: string[]) => mocks.join(...parts),
    info: (uri: string) => mocks.info(uri),
  },
  File: class {
    uri: string;

    constructor(uri: string) {
      this.uri = mocks.normalize(uri);
    }

    get name(): string {
      return this.uri.split('/').pop() ?? '';
    }

    get size(): number {
      return mocks.entries.get(this.uri)?.content.length ?? 0;
    }

    get type(): string {
      return 'text/plain';
    }

    get creationTime(): number | null {
      return mocks.entries.get(this.uri)?.creationTime ?? null;
    }

    get modificationTime(): number | null {
      return mocks.entries.get(this.uri)?.modificationTime ?? null;
    }

    async copy(destination: { uri: string }): Promise<void> {
      const entry = mocks.entries.get(this.uri);

      if (!entry) {
        throw new Error(`Cannot copy missing file ${this.uri}`);
      }

      mocks.entries.set(mocks.normalize(destination.uri), { ...entry });
    }

    delete(): void {
      if (!mocks.entries.delete(this.uri)) {
        throw new Error(`Cannot delete missing file ${this.uri}`);
      }
    }
  },
  Directory: class {
    uri: string;

    constructor(uri: string) {
      this.uri = mocks.normalize(uri);
    }

    get name(): string {
      return this.uri.split('/').pop() ?? '';
    }

    get size(): number {
      return 0;
    }

    info(): { creationTime: number | null; modificationTime: number | null } {
      const entry = mocks.entries.get(this.uri);
      return {
        creationTime: entry?.creationTime ?? null,
        modificationTime: entry?.modificationTime ?? null,
      };
    }

    create(): void {
      if (!mocks.entries.has(this.uri)) {
        mocks.setFolder(this.uri);
      }
    }

    async copy(destination: { uri: string }): Promise<void> {
      const source = this.uri;
      const target = mocks.normalize(destination.uri);
      const entry = mocks.entries.get(source);

      if (!entry) {
        throw new Error(`Cannot copy missing folder ${source}`);
      }

      mocks.entries.set(target, { ...entry });

      for (const [uri, child] of Array.from(mocks.entries.entries())) {
        if (uri.startsWith(`${source}/`)) {
          mocks.entries.set(`${target}${uri.slice(source.length)}`, { ...child });
        }
      }
    }

    delete(): void {
      for (const uri of Array.from(mocks.entries.keys())) {
        if (uri === this.uri || uri.startsWith(`${this.uri}/`)) {
          mocks.entries.delete(uri);
        }
      }
    }
  },
}));

const DB = {} as SQLiteDatabase;

describe('safety trash', () => {
  let items: Map<string, TrashItem>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    mocks.entries.clear();
    items = new Map();

    vi.spyOn(SafetyStore.prototype, 'insertTrash').mockImplementation(async (item) => {
      items.set(item.id, { ...item });
    });
    vi.spyOn(SafetyStore.prototype, 'getTrash').mockImplementation(async (userId, id) => {
      const item = items.get(id);
      return item?.userId === userId ? item : null;
    });
    vi.spyOn(SafetyStore.prototype, 'latestTrash').mockImplementation(
      async (userId, conversationId) =>
        Array.from(items.values())
          .reverse()
          .find(
            (item) =>
              item.userId === userId &&
              item.status === 'trashed' &&
              (conversationId === undefined ||
                conversationId === null ||
                item.conversationId === conversationId)
          ) ?? null
    );
    vi.spyOn(SafetyStore.prototype, 'updateTrashStatus').mockImplementation(
      async (userId, id, status, timestamp, failureReason = null) => {
        const item = items.get(id);

        if (item && item.userId === userId) {
          item.status = status;
          item.failureReason = failureReason;
          if (status === 'restored') {
            item.restoredAt = timestamp;
          }
          if (status === 'purged') {
            item.purgedAt = timestamp;
          }
        }
      }
    );
    vi.spyOn(SafetyStore.prototype, 'listExpiredTrash').mockImplementation(
      async (now) =>
        Array.from(items.values()).filter(
          (item) => item.status === 'trashed' && item.expiresAt <= now
        )
    );
    vi.spyOn(permissionManager, 'recordActivity').mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('keeps original bytes and metadata, then restores to the exact path', async () => {
    const path = `${mocks.root}/notes.txt`;
    mocks.setFile(path, 'original bytes', 111, 222);
    const trash = new SafetyTrash(DB);

    const item = await trash.trashPath({
      userId: 1,
      conversationId: 7,
      agentId: 'developer',
      path,
      reason: 'Cleanup',
    });

    expect(mocks.exists(path)).toBe(false);
    expect(mocks.read(item.storedPath)).toBe('original bytes');
    expect(item.metadata).toMatchObject({
      kind: 'file',
      originalPath: path,
      createdAt: 111,
      modifiedAt: 222,
      reason: 'Cleanup',
    });
    expect(permissionManager.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'success',
        category: 'file_delete',
        reversible: true,
      })
    );

    const restored = await trash.restore({
      userId: 1,
      conversationId: 7,
      agentId: 'developer',
    });

    expect(restored.id).toBe(item.id);
    expect(restored.status).toBe('restored');
    expect(mocks.read(path)).toBe('original bytes');
    expect(mocks.exists(item.storedPath)).toBe(false);
    expect(permissionManager.recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'restored', resourceKey: path })
    );

    await expect(
      trash.restore({ userId: 1, conversationId: 7, agentId: 'developer', id: item.id })
    ).rejects.toThrow(/already been restored/);
  });

  it('refuses to trash paths outside Orbit documents', async () => {
    const outside = 'file:///etc/passwd';
    mocks.setFile(outside, 'secret');

    await expect(
      new SafetyTrash(DB).trashPath({ userId: 1, agentId: 'developer', path: outside })
    ).rejects.toThrow(/Only files inside Orbit’s document folder/);
    expect(mocks.read(outside)).toBe('secret');
  });

  it('purges expired trash instead of silently keeping it forever', async () => {
    const path = `${mocks.root}/old.txt`;
    mocks.setFile(path, 'old bytes');
    const trash = new SafetyTrash(DB);
    const item = await trash.trashPath({ userId: 1, agentId: 'developer', path });

    const purged = await trash.purgeExpired(item.expiresAt + 1);

    expect(purged).toBe(1);
    expect(mocks.exists(item.storedPath)).toBe(false);
    expect(items.get(item.id)?.status).toBe('purged');
  });
});
