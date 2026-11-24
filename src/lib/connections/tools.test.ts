import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { agentToolRegistry } from '@/lib/ai/tool-registry';

import { CONNECTION_TOOLS, CONNECTION_TOOL_NAMES } from './tools';
import { ConnectionError } from './types';

const apiMocks = vi.hoisted(() => ({
  gmailSearch: vi.fn(),
  gmailRead: vi.fn(),
  gmailDraft: vi.fn(),
  gmailSend: vi.fn(),
  calendarSearch: vi.fn(),
  calendarCreate: vi.fn(),
  calendarUpdate: vi.fn(),
  driveSearch: vi.fn(),
  driveRead: vi.fn(),
  driveTrash: vi.fn(),
}));

vi.mock('./api', () => apiMocks);

const db = {} as SQLiteDatabase;

describe('connection tools', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers real Gmail, Calendar and Drive tools with provenance', () => {
    for (const name of CONNECTION_TOOL_NAMES) {
      expect(agentToolRegistry.get(name)).not.toBeNull();
    }

    const gmailSend = agentToolRegistry.get('google_gmail_send');
    expect(gmailSend?.meta).toMatchObject({
      source: 'connection',
      pluginId: 'connection.gmail',
      permissions: ['connection.gmail.write'],
    });
    expect(CONNECTION_TOOLS.some((tool) => tool.connectionId === 'google_calendar')).toBe(true);
  });

  it('returns a safe failure when the account is not authorized', async () => {
    apiMocks.gmailSearch.mockRejectedValue(
      new ConnectionError('unauthorized', 'Gmail is not connected.', 'gmail')
    );

    const result = await agentToolRegistry.execute(
      { db, userId: 1 },
      'google_gmail_search',
      '{"query":"release"}'
    );

    expect(JSON.parse(result.content)).toMatchObject({
      ok: false,
      error: 'Gmail is not connected.',
    });
    expect(result.trace).toContain('failed');
  });

  it('does not call the remote API after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await agentToolRegistry.execute(
      { db, userId: 1, signal: controller.signal },
      'google_gmail_search',
      '{"query":"release"}'
    );

    expect(JSON.parse(result.content)).toMatchObject({ ok: false });
    expect(apiMocks.gmailSearch).not.toHaveBeenCalled();
  });
});
