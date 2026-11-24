import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSqliteChatStore } from './chat-store';

vi.mock('./buddy/rewards', () => ({
  rewardChatMessage: vi.fn(async () => undefined),
}));

type ConversationRow = {
  id: number;
  user_id: number;
  title: string;
  agent_id: string | null;
  created_at: number;
  updated_at: number;
};

type MessageRow = {
  id: number;
  user_id: number;
  conversation_id: number;
  role: string;
  content: string;
  meta: string | null;
  created_at: number;
};

function makeDb() {
  const conversations: ConversationRow[] = [];
  const messages: MessageRow[] = [];
  let nextConversationId = 1;
  let nextMessageId = 1;

  const conversationRow = (row: ConversationRow) => ({
    ...row,
    message_count: messages.filter((message) => message.conversation_id === row.id).length,
  });

  const db = {
    getFirstAsync: vi.fn(async (_sql: string, ...params: unknown[]) => {
      const id = params[0] as number;
      const userId = params[1] as number;
      const row = conversations.find(
        (item) => item.id === id && item.user_id === userId
      );

      return row ? conversationRow(row) : null;
    }),
    getAllAsync: vi.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.includes('FROM conversations')) {
        const userId = params[0] as number;
        const agentId =
          typeof params[1] === 'string' ? (params[1] as string) : null;
        const limit = Number(params[params.length - 1] ?? 100);

        return conversations
          .filter(
            (item) =>
              item.user_id === userId && (agentId === null || item.agent_id === agentId)
          )
          .sort((a, b) => b.updated_at - a.updated_at || b.id - a.id)
          .slice(0, limit)
          .map(conversationRow);
      }

      const userId = params[0] as number;
      const conversationId = params[1] as number;
      const limit = Number(params[2] ?? 100);

      return messages
        .filter(
          (message) => message.user_id === userId && message.conversation_id === conversationId
        )
        .sort((a, b) => b.id - a.id)
        .slice(0, limit)
        .sort((a, b) => a.id - b.id)
        .map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          meta: message.meta,
          created_at: message.created_at,
        }));
    }),
    runAsync: vi.fn(async (sql: string, ...params: unknown[]) => {
      if (sql.startsWith('INSERT INTO conversations')) {
        const id = nextConversationId++;
        conversations.push({
          id,
          user_id: params[0] as number,
          title: params[1] as string,
          agent_id: (params[2] as string | null) ?? null,
          created_at: params[3] as number,
          updated_at: params[4] as number,
        });
        return { lastInsertRowId: id, changes: 1 };
      }

      if (sql.startsWith('INSERT INTO messages')) {
        const id = nextMessageId++;
        messages.push({
          id,
          user_id: params[0] as number,
          conversation_id: params[1] as number,
          role: params[2] as string,
          content: params[3] as string,
          meta: (params[4] as string | null) ?? null,
          created_at: params[5] as number,
        });
        return { lastInsertRowId: id, changes: 1 };
      }

      if (sql.startsWith('UPDATE conversations')) {
        const title = params[0] as string;
        const now = params[2] as number;
        const id = params[3] as number;
        const userId = params[4] as number;
        const row = conversations.find(
          (item) => item.id === id && item.user_id === userId
        );

        if (row) {
          if (row.title === 'New chat' && title) {
            row.title = title;
          }
          row.updated_at = now;
        }

        return { changes: 1 };
      }

      if (sql.startsWith('DELETE FROM messages')) {
        const userId = params[0] as number;
        const conversationId = params[1] as number;

        for (let index = messages.length - 1; index >= 0; index -= 1) {
          const message = messages[index];
          if (message.user_id === userId && message.conversation_id === conversationId) {
            messages.splice(index, 1);
          }
        }

        return { changes: 1 };
      }

      if (sql.startsWith('DELETE FROM conversations')) {
        const id = params[0] as number;
        const userId = params[1] as number;
        const index = conversations.findIndex(
          (item) => item.id === id && item.user_id === userId
        );

        if (index >= 0) {
          conversations.splice(index, 1);
        }

        return { changes: 1 };
      }

      return { changes: 0 };
    }),
  };

  return db as unknown as SQLiteDatabase;
}

describe('SQLite chat store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('scopes conversations by agent and user', async () => {
    const db = makeDb();
    const store = createSqliteChatStore(db);

    await store.createConversation(1, 'New chat', 'master');
    await store.createConversation(1, 'Research', 'research');
    await store.createConversation(2, 'Other user', 'master');

    expect((await store.listConversations(1)).map((item) => item.title)).toEqual([
      'Research',
      'New chat',
    ]);
    expect((await store.listConversations(1, 50, 'research')).map((item) => item.title)).toEqual([
      'Research',
    ]);
    expect(await store.getConversation(2, 1)).toBeNull();
  });

  it('persists attachment metadata and tool events on messages', async () => {
    const db = makeDb();
    const store = createSqliteChatStore(db);
    const conversation = await store.createConversation(1, 'New chat', 'research');

    await store.addMessage(
      1,
      conversation.id,
      'user',
      'Check this file',
      [],
      [],
      {
        agentId: 'research',
        attachments: [
          {
            id: 'att_1',
            name: 'note.txt',
            kind: 'document',
            mimeType: 'text/plain',
            uri: 'file:///note.txt',
            size: 12,
            textPreview: 'hello',
          },
        ],
      }
    );

    await store.addMessage(1, conversation.id, 'assistant', 'Done', [], [], {
      toolEvents: [
        {
          id: 'tool_1',
          toolName: 'google_gmail_search',
          status: 'success',
          startedAt: 10,
          endedAt: 20,
          durationMs: 10,
          summary: 'Searched Gmail',
        },
      ],
    });

    const messages = await store.listMessages(1, conversation.id);

    expect(messages[0].attachments?.[0]).toMatchObject({
      id: 'att_1',
      name: 'note.txt',
      textPreview: 'hello',
    });
    expect(messages[0].agentId).toBe('research');
    expect(messages[1].toolEvents?.[0]).toMatchObject({
      toolName: 'google_gmail_search',
      status: 'success',
    });
  });

  it('updates the title on the first user message and deletes scoped data', async () => {
    const db = makeDb();
    const store = createSqliteChatStore(db);
    const conversation = await store.createConversation(1);

    await store.addMessage(1, conversation.id, 'user', 'Plan the release');

    const updated = await store.getConversation(1, conversation.id);
    expect(updated?.title).toBe('Plan the release');
    expect(updated?.messageCount).toBe(1);

    await store.deleteConversation(1, conversation.id);
    expect(await store.getConversation(1, conversation.id)).toBeNull();
    expect(await store.listMessages(1, conversation.id)).toEqual([]);
  });
});
