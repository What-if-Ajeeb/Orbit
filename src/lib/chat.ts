import type { SQLiteDatabase } from 'expo-sqlite';

export type ChatRole = 'user' | 'assistant';

export type ChatMessage = {
  id: number;
  role: ChatRole;
  content: string;
  traces: string[];
  createdAt: number;
};

type MessageRow = {
  id: number;
  role: string;
  content: string;
  meta: string | null;
  created_at: number;
};

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

export async function listMessages(
  db: SQLiteDatabase,
  userId: number,
  limit = 100
): Promise<ChatMessage[]> {
  const rows = await db.getAllAsync<MessageRow>(
    `SELECT id, role, content, meta, created_at
     FROM (
       SELECT id, role, content, meta, created_at
       FROM messages
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT ?
     )
     ORDER BY id ASC`,
    userId,
    Math.min(Math.max(limit, 1), 300)
  );

  return rows.map(toMessage);
}

export async function addMessage(
  db: SQLiteDatabase,
  userId: number,
  role: ChatRole,
  content: string,
  traces: string[] = []
): Promise<ChatMessage> {
  const createdAt = Date.now();
  const meta = traces.length > 0 ? JSON.stringify({ traces }) : null;

  const result = await db.runAsync(
    'INSERT INTO messages (user_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)',
    userId,
    role,
    content,
    meta,
    createdAt
  );

  return {
    id: result.lastInsertRowId,
    role,
    content,
    traces,
    createdAt,
  };
}

export async function clearMessages(db: SQLiteDatabase, userId: number): Promise<void> {
  await db.runAsync('DELETE FROM messages WHERE user_id = ?', userId);
}
