import type { SQLiteDatabase } from 'expo-sqlite';

export type EventType =
  | 'turn_started'
  | 'turn_ended'
  | 'step_started'
  | 'step_ended'
  | 'tool_call'
  | 'tool_result'
  | 'message_added'
  | 'ai_request'
  | 'ai_response'
  | 'forked'
  | 'resumed'
  | 'paused';

export type StoredEvent = {
  id: number;
  conversationId: number;
  userId: number;
  type: EventType;
  payload: Record<string, unknown>;
  createdAt: number;
  sequenceNumber: number;
};

/**
 * Append-only event store. Every agent turn, tool call and mutation is
 * recorded as an immutable event so conversations can be paused, resumed,
 * forked or replayed later.
 */
export class EventStore {
  constructor(private db: SQLiteDatabase) {}

  async appendEvent(
    userId: number,
    conversationId: number,
    type: EventType,
    payload: Record<string, unknown>
  ): Promise<StoredEvent> {
    const sequence = (await this.getLastSequence(userId, conversationId)) + 1;
    const now = Date.now();
    const result = await this.db.runAsync(
      `INSERT INTO events (conversation_id, user_id, type, payload, created_at, sequence_number)
       VALUES (?, ?, ?, ?, ?, ?)`,
      conversationId,
      userId,
      type,
      JSON.stringify(payload),
      now,
      sequence
    );

    return {
      id: (result.lastInsertRowId as number) ?? 0,
      conversationId,
      userId,
      type,
      payload,
      createdAt: now,
      sequenceNumber: sequence,
    };
  }

  async listEvents(
    userId: number,
    conversationId: number,
    limit = 200
  ): Promise<StoredEvent[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT id, conversation_id AS conversationId, user_id AS userId, type, payload,
              created_at AS createdAt, sequence_number AS sequenceNumber
       FROM events
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY sequence_number DESC
       LIMIT ?`,
      userId,
      conversationId,
      limit
    )) as {
      id: number;
      conversationId: number;
      userId: number;
      type: string;
      payload: string;
      createdAt: number;
      sequenceNumber: number;
    }[];

    return rows.map((row) => ({
      ...row,
      payload:
        typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      type: row.type as EventType,
    }));
  }

  async getLastSequence(
    userId: number,
    conversationId: number
  ): Promise<number> {
    const row = await this.db.getFirstAsync<{ maxSeq: number }>(
      `SELECT MAX(sequence_number) AS maxSeq
       FROM events
       WHERE user_id = ? AND conversation_id = ?`,
      userId,
      conversationId
    );
    return row?.maxSeq ?? 0;
  }

  async forkConversation(
    userId: number,
    sourceConversationId: number,
    title: string,
    upToSequence?: number
  ): Promise<number> {
    const sourceEvents = (await this.db.getAllAsync(
      `SELECT type, payload, sequence_number
       FROM events
       WHERE user_id = ? AND conversation_id = ?
         ${upToSequence !== undefined ? 'AND sequence_number <= ?' : ''}
       ORDER BY sequence_number`,
      upToSequence !== undefined
        ? [userId, sourceConversationId, upToSequence]
        : [userId, sourceConversationId]
    )) as { type: string; payload: string; sequence_number: number }[];

    const now = Date.now();
    const result = await this.db.runAsync(
      `INSERT INTO conversations (user_id, title, created_at, updated_at)
       VALUES (?, ?, ?, ?)`,
      userId,
      title,
      now,
      now
    );
    const newConversationId = (result.lastInsertRowId as number) ?? 0;

    let seq = 0;
    for (const ev of sourceEvents) {
      seq += 1;
      await this.db.runAsync(
        `INSERT INTO events (conversation_id, user_id, type, payload, created_at, sequence_number)
         VALUES (?, ?, ?, ?, ?, ?)`,
        newConversationId,
        userId,
        ev.type,
        ev.payload,
        now,
        seq
      );
    }

    await this.appendEvent(userId, newConversationId, 'forked', {
      sourceConversationId,
      forkedAt: now,
      eventsCopied: sourceEvents.length,
    });

    return newConversationId;
  }

  async resumeConversation(
    userId: number,
    conversationId: number
  ): Promise<StoredEvent | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT id, conversation_id AS conversationId, user_id AS userId, type, payload,
              created_at AS createdAt, sequence_number AS sequenceNumber
       FROM events
       WHERE user_id = ? AND conversation_id = ?
       ORDER BY sequence_number DESC
       LIMIT 1`,
      userId,
      conversationId
    )) as {
      id: number;
      conversationId: number;
      userId: number;
      type: string;
      payload: string;
      createdAt: number;
      sequenceNumber: number;
    } | null;

    if (!row) {
      return null;
    }

    return {
      id: row.id,
      conversationId: row.conversationId,
      userId: row.userId,
      type: row.type as EventType,
      payload: typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      createdAt: row.createdAt,
      sequenceNumber: row.sequenceNumber,
    };
  }
}
