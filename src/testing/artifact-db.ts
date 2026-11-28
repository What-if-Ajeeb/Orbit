import type { SQLiteDatabase } from 'expo-sqlite';
import { vi } from 'vitest';

type VersionState = { version: number; content: string; summary: string | null };

type InitialArtifact = {
  id?: string;
  title?: string;
  type?: string;
  language?: string | null;
  conversationId?: number | null;
  content?: string;
  currentVersion?: number;
};

function kvPrefix(userId: number, artifactId: string): string {
  return `${JSON.stringify([userId, artifactId])}|`;
}

function kvKey(userId: number, artifactId: string, key: string): string {
  return `${kvPrefix(userId, artifactId)}${JSON.stringify(key)}`;
}

/**
 * Small in-memory stand-in for the artifact tables. It implements only the
 * SQL ArtifactStore issues, so tests can exercise real store and tool code
 * without a native SQLite module.
 */
export function artifactTestDb(initial: InitialArtifact = {}) {
  const state = {
    id: initial.id ?? 'art_test',
    title: initial.title ?? 'Test artifact',
    type: initial.type ?? 'markdown',
    language: initial.language ?? null,
    conversationId: initial.conversationId ?? null,
    content: initial.content ?? 'Hello world',
    currentVersion: initial.currentVersion ?? 1,
    createdAt: 1,
    updatedAt: 2,
    versions: [] as VersionState[],
    kv: new Map<string, string>(),
  };

  state.versions.push({ version: state.currentVersion, content: state.content, summary: null });

  const executed: string[] = [];

  const raw = {
    runAsync: vi.fn(async (sql: string, ...params: unknown[]) => {
      executed.push(sql);

      if (/INSERT INTO artifacts/i.test(sql)) {
        state.id = String(params[0]);
        state.conversationId = params[2] == null ? null : Number(params[2]);
        state.title = String(params[3]);
        state.type = String(params[4]);
        state.language = params[5] == null ? null : String(params[5]);
        state.currentVersion = 1;
        state.versions = [];
        state.createdAt = Number(params[6]);
        state.updatedAt = Number(params[7]);
        return;
      }

      if (/INSERT INTO artifact_versions/i.test(sql)) {
        const version = params.length === 3 ? 1 : Number(params[1]);
        const content = String(params[params.length === 3 ? 1 : 2]);
        const summaryParam = params.length === 3 ? null : params[3];

        state.content = content;
        state.currentVersion = version;
        state.versions = state.versions.filter((entry) => entry.version !== version);
        state.versions.push({
          version,
          content,
          summary: summaryParam == null ? null : String(summaryParam),
        });
        state.updatedAt = Date.now();
        return;
      }

      if (/UPDATE artifacts SET current_version/i.test(sql)) {
        state.currentVersion = Number(params[0]);
        state.updatedAt = Number(params[1]);
        return;
      }

      if (/DELETE FROM artifact_versions/i.test(sql)) {
        const cutoff = Number(params[1]);
        state.versions = state.versions.filter((entry) => entry.version > cutoff);
        return;
      }

      if (/INSERT INTO artifact_kv/i.test(sql)) {
        state.kv.set(
          kvKey(Number(params[1]), String(params[0]), String(params[2])),
          String(params[3])
        );
        return;
      }

      if (/DELETE FROM artifact_kv/i.test(sql)) {
        state.kv.delete(kvKey(Number(params[0]), String(params[1]), String(params[2])));
        return;
      }

      if (/DELETE FROM artifacts/i.test(sql)) {
        state.id = '';
        state.kv.clear();
      }
    }),
    getFirstAsync: vi.fn(async (sql: string, ...params: unknown[]) => {
      executed.push(sql);

      if (/SELECT value FROM artifact_kv/i.test(sql)) {
        const value = state.kv.get(
          kvKey(Number(params[0]), String(params[1]), String(params[2]))
        );
        return value === undefined ? null : { value };
      }

      if (/COALESCE\(SUM\(LENGTH\(value\)\)/i.test(sql)) {
        const prefix = kvPrefix(Number(params[0]), String(params[1]));
        let total = 0;

        for (const [key, value] of state.kv.entries()) {
          if (key.startsWith(prefix)) {
            total += value.length;
          }
        }

        return { total };
      }

      if (/SELECT id FROM artifacts WHERE id/i.test(sql)) {
        return String(params[0]) === state.id && Number(params[1]) === 1 ? { id: state.id } : null;
      }

      if (/FROM artifact_versions/i.test(sql)) {
        const version = Number(params[1]);
        const found = state.versions.find((entry) => entry.version === version);

        return found
          ? {
              id: version,
              artifact_id: state.id,
              version,
              content: found.content,
              summary: found.summary,
              created_at: state.createdAt,
            }
          : null;
      }

      if (/LEFT JOIN artifact_versions/i.test(sql)) {
        if (String(params[0]) !== state.id || Number(params[1]) !== 1) {
          return null;
        }

        return {
          id: state.id,
          user_id: 1,
          conversation_id: state.conversationId,
          title: state.title,
          type: state.type,
          language: state.language,
          current_version: state.currentVersion,
          created_at: state.createdAt,
          updated_at: state.updatedAt,
          content: state.content,
        };
      }

      return null;
    }),
    getAllAsync: vi.fn(async (sql: string, ...params: unknown[]) => {
      executed.push(sql);

      if (/SELECT key FROM artifact_kv/i.test(sql)) {
        const prefix = kvPrefix(Number(params[0]), String(params[1]));

        return [...state.kv.entries()]
          .filter(([key]) => key.startsWith(prefix))
          .map(([key]) => ({ key: JSON.parse(key.slice(prefix.length)) as string }))
          .sort((left, right) => left.key.localeCompare(right.key));
      }

      if (/FROM artifact_versions/i.test(sql) && String(params[0]) === state.id) {
        return [...state.versions]
          .sort((left, right) => right.version - left.version)
          .map((entry) => ({
            id: entry.version,
            artifact_id: state.id,
            version: entry.version,
            content: '',
            summary: entry.summary,
            created_at: state.createdAt,
          }));
      }

      return [];
    }),
    withTransactionAsync: vi.fn(async (task: () => Promise<void>) => {
      await task();
    }),
    execAsync: vi.fn(async (_sql: string) => undefined),
  };

  return { db: raw as unknown as SQLiteDatabase, state, executed, mocks: raw };
}
