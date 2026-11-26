import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadAiSettings } from './ai/settings';
import { setWebSearchPreference } from './chat-preferences';
import { WEB_SEARCH_SKILL_ID, WEB_SEARCH_TOOL_NAME } from './skills';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-1' }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

type MemoryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function makeDb() {
  let agentRow: Record<string, unknown> | null = null;
  const skills = new Map<string, { enabled: number }>();

  const db = {
    getFirstAsync: vi.fn(async () => agentRow),
    getAllAsync: vi.fn(async () => []),
    runAsync: vi.fn(async (sql: string, ...args: unknown[]) => {
      if (sql.includes('INSERT INTO skills')) {
        skills.set(String(args[0]), { enabled: Number(args[5]) });
      } else if (sql.includes('UPDATE skills')) {
        const skill = skills.get(String(args[2]));
        if (skill) {
          skill.enabled = Number(args[0]);
        }
      } else if (sql.includes('INSERT INTO agent_configs')) {
        agentRow = {
          user_id: args[0],
          agent_id: args[1],
          instructions: args[2],
          memory: args[3],
          tool_access_mode: args[4],
          allowed_tools: args[5],
          created_at: args[6],
          updated_at: args[7],
        };
      }
    }),
  };

  return { db: db as unknown as SQLiteDatabase, mocks: { skills, getAgentRow: () => agentRow } };
}

describe('chat preferences', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    (globalThis as { localStorage?: MemoryStorage }).localStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value);
      },
      removeItem: (key) => {
        values.delete(key);
      },
    };
  });

  it('enables the built-in Web Search skill and agent tool together', async () => {
    const { db, mocks } = makeDb();

    const saved = await setWebSearchPreference(db, 1, 'master', true);

    expect(saved.webSearch).toBe(true);
    expect((await loadAiSettings()).webSearch).toBe(true);
    expect(mocks.skills.get(WEB_SEARCH_SKILL_ID)?.enabled).toBe(1);
    expect(JSON.parse(String(mocks.getAgentRow()?.allowed_tools))).toContain(WEB_SEARCH_TOOL_NAME);
  });

  it('disables Web Search without deleting the skill definition', async () => {
    const { db, mocks } = makeDb();

    await setWebSearchPreference(db, 1, 'master', false);

    expect((await loadAiSettings()).webSearch).toBe(false);
    expect(mocks.skills.has(WEB_SEARCH_SKILL_ID)).toBe(true);
    expect(mocks.skills.get(WEB_SEARCH_SKILL_ID)?.enabled).toBe(0);
    expect(JSON.parse(String(mocks.getAgentRow()?.allowed_tools))).not.toContain(
      WEB_SEARCH_TOOL_NAME
    );
  });
});
