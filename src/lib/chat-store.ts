import type { SQLiteDatabase } from 'expo-sqlite';

import { rewardChatMessage } from './buddy/rewards';

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  id: number;
  role: ChatRole;
  content: string;
  traces: string[];
  createdAt: number;
};

export type Conversation = {
  id: number;
  userId: number;
  title: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
};

/**
 * Storage seam for conversations. The SQLite provider below is the default;
 * another provider can implement this interface without changing the screens
 * or the agent.
 */
export type ChatStore = {
  listConversations(userId: number, limit?: number): Promise<Conversation[]>;
  getConversation(userId: number, conversationId: number): Promise<Conversation | null>;
  createConversation(userId: number, title?: string): Promise<Conversation>;
  listMessages(
    userId: number,
    conversationId: number,
    limit?: number
  ): Promise<ChatMessage[]>;
  addMessage(
    userId: number,
    conversationId: number,
    role: ChatRole,
    content: string,
    traces?: string[]
  ): Promise<ChatMessage>;
  deleteConversation(userId: number, conversationId: number): Promise<void>;
  clearAllChat(userId: number): Promise<void>;
};

type MessageRow = {
  id: number;
  role: string;
  content: string;
  meta: string | null;
  created_at: number;
};

type ConversationRow = {
  id: number;
  user_id: number;
  title: string;
  message_count: number;
  created_at: number;
  updated_at: number;
};

const CONVERSATION_SELECT = `
  SELECT c.id, c.user_id, c.title, c.created_at, c.updated_at,
    (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS message_count
  FROM conversations c
`;

function parseTraces(meta: string | null): string[] {
  if (!meta) {
    return [];
  }

  try {
    const value = JSON.parse(meta) as { traces?: unknown };

    if (!Array.isArray(value.traces)) {
      return [];
    }

    return value.traces.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    traces: parseTraces(row.meta),
    createdAt: row.created_at,
  };
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    messageCount: row.message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

export function createSqliteChatStore(db: SQLiteDatabase): ChatStore {
  async function getConversation(
    userId: number,
    conversationId: number
  ): Promise<Conversation | null> {
    const row = await db.getFirstAsync<ConversationRow>(
      `${CONVERSATION_SELECT} WHERE c.id = ? AND c.user_id = ?`,
      conversationId,
      userId
    );

    return row ? toConversation(row) : null;
  }

  return {
    async listConversations(userId, limit = 50) {
      const rows = await db.getAllAsync<ConversationRow>(
        `${CONVERSATION_SELECT}
         WHERE c.user_id = ?
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ?`,
        userId,
        Math.min(Math.max(limit, 1), 100)
      );

      return rows.map(toConversation);
    },

    getConversation,

    async createConversation(userId, title = 'New chat') {
      const now = Date.now();
      const clean = cleanTitle(title) || 'New chat';

      const result = await db.runAsync(
        'INSERT INTO conversations (user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
        userId,
        clean,
        now,
        now
      );

      return {
        id: result.lastInsertRowId,
        userId,
        title: clean,
        messageCount: 0,
        createdAt: now,
        updatedAt: now,
      };
    },

    async listMessages(userId, conversationId, limit = 100) {
      const rows = await db.getAllAsync<MessageRow>(
        `SELECT id, role, content, meta, created_at
         FROM (
           SELECT id, role, content, meta, created_at
           FROM messages
           WHERE user_id = ? AND conversation_id = ?
           ORDER BY id DESC
           LIMIT ?
         )
         ORDER BY id ASC`,
        userId,
        conversationId,
        Math.min(Math.max(limit, 1), 300)
      );

      return rows.map(toMessage);
    },

    async addMessage(userId, conversationId, role, content, traces = []) {
      const conversation = await getConversation(userId, conversationId);

      if (!conversation) {
        throw new Error('Conversation not found.');
      }

      const createdAt = Date.now();
      const meta = traces.length > 0 ? JSON.stringify({ traces }) : null;

      const result = await db.runAsync(
        `INSERT INTO messages (user_id, conversation_id, role, content, meta, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        userId,
        conversationId,
        role,
        content,
        meta,
        createdAt
      );

      const nextTitle = role === 'user' ? cleanTitle(content) : '';

      await db.runAsync(
        `UPDATE conversations
         SET title = CASE
               WHEN title = 'New chat' AND ? <> '' THEN ?
               ELSE title
             END,
             updated_at = ?
         WHERE id = ? AND user_id = ?`,
        nextTitle,
        nextTitle,
        createdAt,
        conversationId,
        userId
      );

      // Phase 3: small XP + bond for every user message
      if (role === 'user') {
        try {
          await rewardChatMessage(db, userId);
        } catch (err) {
          console.warn('Buddy chat reward failed', err);
        }
      }

      return {
        id: result.lastInsertRowId,
        role,
        content,
        traces,
        createdAt,
      };
    },

    async deleteConversation(userId, conversationId) {
      await db.runAsync(
        'DELETE FROM messages WHERE user_id = ? AND conversation_id = ?',
        userId,
        conversationId
      );
      await db.runAsync(
        'DELETE FROM conversations WHERE id = ? AND user_id = ?',
        conversationId,
        userId
      );
    },

    async clearAllChat(userId) {
      await db.runAsync('DELETE FROM messages WHERE user_id = ?', userId);
      await db.runAsync('DELETE FROM conversations WHERE user_id = ?', userId);
    },
  };
}
