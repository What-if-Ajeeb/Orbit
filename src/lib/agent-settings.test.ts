import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  defaultAgentConfig,
  filterAllowedTools,
  isToolAllowedForAgent,
  loadAgentConfig,
  matchesToolPattern,
  newToolEventId,
  saveAgentConfig,
} from './agent-settings';

vi.mock('expo-crypto', () => ({
  randomUUID: () => 'uuid-1',
}));

type ConfigRow = {
  user_id: number;
  agent_id: string;
  instructions: string;
  memory: string;
  tool_access_mode: string;
  allowed_tools: string;
  created_at: number;
  updated_at: number;
};

function makeDb() {
  const rows = new Map<string, ConfigRow>();

  const key = (userId: number, agentId: string) => `${userId}:${agentId}`;

  const db = {
    getFirstAsync: vi.fn(async (_sql: string, userId: number, agentId: string) => {
      return rows.get(key(userId, agentId)) ?? null;
    }),
    getAllAsync: vi.fn(async (_sql: string, userId: number) => {
      return Array.from(rows.values()).filter((row) => row.user_id === userId);
    }),
    runAsync: vi.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.startsWith('DELETE')) {
        rows.delete(key(params[0] as number, params[1] as string));
        return { changes: 1 };
      }

      const row: ConfigRow = {
        user_id: params[0] as number,
        agent_id: params[1] as string,
        instructions: params[2] as string,
        memory: params[3] as string,
        tool_access_mode: params[4] as string,
        allowed_tools: params[5] as string,
        created_at: params[6] as number,
        updated_at: params[7] as number,
      };
      rows.set(key(row.user_id, row.agent_id), row);
      return { changes: 1 };
    }),
  };

  return { db: db as unknown as SQLiteDatabase, mocks: db, rows };
}

describe('agent settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults to a small safe allowlist and selected mode', () => {
    const config = defaultAgentConfig(7, 'research');

    expect(config.toolAccessMode).toBe('selected');
    expect(config.allowedTools).toContain('list_tasks');
    expect(config.allowedTools).toContain('artifact_read');
    expect(config.allowedTools).toContain('orbit_plugin_discover');
    expect(config.allowedTools).toContain('orbit_plugin_request');
    expect(config.allowedTools).not.toContain('google_gmail_send');
  });

  it('matches exact and wildcard tool patterns', () => {
    expect(matchesToolPattern('google_gmail_send', 'google_gmail_send')).toBe(true);
    expect(matchesToolPattern('google_*', 'google_drive_read')).toBe(true);
    expect(matchesToolPattern('*_read', 'google_drive_read')).toBe(true);
    expect(matchesToolPattern('google_*_read', 'google_drive_read')).toBe(true);
    expect(matchesToolPattern('google_*_read', 'google_drive_read_all')).toBe(false);
    expect(matchesToolPattern('google_*', 'plugin__mail__send')).toBe(false);
    expect(matchesToolPattern('', 'anything')).toBe(false);
  });

  it('rejects oversized patterns and tool names before matching', () => {
    expect(matchesToolPattern('*'.repeat(121), 'anything')).toBe(false);
    expect(matchesToolPattern('anything', 'a'.repeat(257))).toBe(false);
  });

  it('filters tools with an agent allowlist or all access', () => {
    const config = defaultAgentConfig(7, 'research');
    const tools = [
      { name: 'list_tasks' },
      { name: 'google_gmail_send' },
      { name: 'artifact_list' },
    ];

    expect(filterAllowedTools(tools, config).map((tool) => tool.name)).toEqual([
      'list_tasks',
      'artifact_list',
    ]);

    expect(
      isToolAllowedForAgent({ ...config, toolAccessMode: 'all' }, 'google_gmail_send')
    ).toBe(true);
  });

  it('normalizes and persists agent instructions, memory and tool patterns', async () => {
    const { db } = makeDb();

    const saved = await saveAgentConfig(db, 7, 'research', {
      instructions: '  Be concise.  ',
      memory: 'Prefers local tools',
      toolAccessMode: 'selected',
      allowedTools: [' google_* ', 'list_tasks', 'google_*', '', 42 as unknown as string],
    });

    expect(saved.instructions).toBe('Be concise.');
    expect(saved.allowedTools).toEqual(['google_*', 'list_tasks']);

    const loaded = await loadAgentConfig(db, 7, 'research');
    expect(loaded.memory).toBe('Prefers local tools');
    expect(loaded.toolAccessMode).toBe('selected');
  });

  it('keeps omitted fields when saving part of a config', async () => {
    const { db } = makeDb();

    await saveAgentConfig(db, 7, 'research', {
      instructions: 'Keep this instruction.',
      memory: 'Keep this memory.',
      toolAccessMode: 'selected',
      allowedTools: ['list_tasks'],
    });

    const updated = await saveAgentConfig(db, 7, 'research', {
      toolAccessMode: 'all',
    });

    expect(updated.instructions).toBe('Keep this instruction.');
    expect(updated.memory).toBe('Keep this memory.');
    expect(updated.allowedTools).toEqual(['list_tasks']);
    expect(updated.toolAccessMode).toBe('all');
  });

  it('generates namespaced tool event ids', () => {
    expect(newToolEventId()).toBe('tool_uuid-1');
  });
});
