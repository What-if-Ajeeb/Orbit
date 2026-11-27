import type { SQLiteDatabase } from 'expo-sqlite';

import { rewardChatMessage } from './buddy/rewards';
import { isArtifactType, type ArtifactRef, type ArtifactType } from './artifacts/types';
import type { AgentTaskVerification } from './agent-runtime/types';

export type ChatRole = 'user' | 'assistant';

export type ChatAttachment = {
  id: string;
  name: string;
  kind: 'image' | 'document';
  mimeType: string;
  uri: string;
  size: number | null;
  /** Plain text extracted from small text documents; never contains secrets from SecureStore. */
  textPreview?: string;
};

export type ToolExecutionStatus = 'running' | 'success' | 'error' | 'denied';

export type ToolExecutionEvent = {
  id: string;
  toolName: string;
  status: ToolExecutionStatus;
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  summary: string;
  detail?: string;
  policyDecision?: 'allow' | 'deny' | 'ask';
};

export type ChatMessageMeta = {
  attachments?: ChatAttachment[];
  toolEvents?: ToolExecutionEvent[];
  agentId?: string | null;
  /** Durable task status attached to the assistant reply that produced it. */
  agentTaskId?: string | null;
  agentStatus?: string | null;
  agentVerified?: boolean | null;
  verification?: AgentTaskVerification | null;
  /** Legacy persistence fields kept here so meta payloads stay type-safe. */
  traces?: string[];
  artifacts?: ArtifactRef[];
};

export type ChatMessage = {
  id: number;
  role: ChatRole;
  content: string;
  traces: string[];
  /** Artifacts created or updated by this assistant message. */
  artifacts: ArtifactRef[];
  createdAt: number;
} & ChatMessageMeta;

export type Conversation = {
  id: number;
  userId: number;
  title: string;
  messageCount: number;
  agentId: string | null;
  createdAt: number;
  updatedAt: number;
};

/**
 * Storage seam for conversations. The SQLite provider below is the default;
 * another provider can implement this interface without changing the screens
 * or the agent.
 */
export type ChatStore = {
  listConversations(
    userId: number,
    limit?: number,
    agentId?: string | null
  ): Promise<Conversation[]>;
  getConversation(userId: number, conversationId: number): Promise<Conversation | null>;
  createConversation(userId: number, title?: string, agentId?: string | null): Promise<Conversation>;
  listMessages(
    userId: number,
    conversationId: number,
    limit?: number
  ): Promise<ChatMessage[]>;
  /** Bounded, parameterised keyword search scoped to one conversation. */
  searchMessages(
    userId: number,
    conversationId: number,
    query: string,
    limit?: number
  ): Promise<ChatMessage[]>;
  addMessage(
    userId: number,
    conversationId: number,
    role: ChatRole,
    content: string,
    traces?: string[],
    artifacts?: ArtifactRef[],
    meta?: ChatMessageMeta
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
  agent_id: string | null;
  created_at: number;
  updated_at: number;
};

const CONVERSATION_SELECT = `
  SELECT c.id, c.user_id, c.title, c.agent_id, c.created_at, c.updated_at,
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

/** Reads artifact refs from message meta; messages written before artifacts keep working. */
function parseArtifacts(meta: string | null): ArtifactRef[] {
  if (!meta) {
    return [];
  }

  try {
    const value = JSON.parse(meta) as { artifacts?: unknown };

    if (!Array.isArray(value.artifacts)) {
      return [];
    }

    const refs: ArtifactRef[] = [];

    for (const item of value.artifacts) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        continue;
      }

      const candidate = item as Record<string, unknown>;

      if (
        typeof candidate.id === 'string' &&
        typeof candidate.title === 'string' &&
        isArtifactType(candidate.type) &&
        typeof candidate.version === 'number' &&
        candidate.version >= 1
      ) {
        refs.push({
          id: candidate.id,
          title: candidate.title,
          type: candidate.type as ArtifactType,
          version: candidate.version,
        });
      }
    }

    return refs;
  } catch {
    return [];
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseMeta(meta: string | null): Record<string, unknown> {
  if (!meta) {
    return {};
  }

  try {
    const value: unknown = JSON.parse(meta);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

function parseAgentVerification(meta: string | null): AgentTaskVerification | null {
  const value = parseMeta(meta).verification;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const candidate = value as Record<string, unknown>;
  if (typeof candidate.verified !== 'boolean' || typeof candidate.reason !== 'string') {
    return null;
  }

  return candidate as unknown as AgentTaskVerification;
}

function parseAttachments(meta: string | null): ChatAttachment[] {
  const value = parseMeta(meta).attachments;

  if (!Array.isArray(value)) {
    return [];
  }

  const attachments: ChatAttachment[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const { id, name, kind, mimeType, uri, size, textPreview } = item;

    if (
      typeof id !== 'string' ||
      typeof name !== 'string' ||
      (kind !== 'image' && kind !== 'document') ||
      typeof mimeType !== 'string' ||
      typeof uri !== 'string'
    ) {
      continue;
    }

    attachments.push({
      id,
      name,
      kind,
      mimeType,
      uri,
      size: typeof size === 'number' && Number.isFinite(size) ? size : null,
      ...(typeof textPreview === 'string' ? { textPreview } : {}),
    });
  }

  return attachments;
}

function parseToolEvents(meta: string | null): ToolExecutionEvent[] {
  const value = parseMeta(meta).toolEvents;

  if (!Array.isArray(value)) {
    return [];
  }

  const events: ToolExecutionEvent[] = [];

  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }

    const { id, toolName, status, startedAt, endedAt, durationMs, summary, detail, policyDecision } =
      item;

    if (
      typeof id !== 'string' ||
      typeof toolName !== 'string' ||
      (status !== 'running' && status !== 'success' && status !== 'error' && status !== 'denied') ||
      typeof startedAt !== 'number' ||
      typeof summary !== 'string'
    ) {
      continue;
    }

    events.push({
      id,
      toolName,
      status,
      startedAt,
      summary,
      ...(typeof endedAt === 'number' ? { endedAt } : {}),
      ...(typeof durationMs === 'number' ? { durationMs } : {}),
      ...(typeof detail === 'string' ? { detail } : {}),
      ...(policyDecision === 'allow' || policyDecision === 'deny' || policyDecision === 'ask'
        ? { policyDecision }
        : {}),
    });
  }

  return events;
}

function toMessage(row: MessageRow): ChatMessage {
  const meta = parseMeta(row.meta);
  const agentId = typeof meta.agentId === 'string' ? meta.agentId : null;

  return {
    id: row.id,
    role: row.role === 'assistant' ? 'assistant' : 'user',
    content: row.content,
    traces: parseTraces(row.meta),
    artifacts: parseArtifacts(row.meta),
    attachments: parseAttachments(row.meta),
    toolEvents: parseToolEvents(row.meta),
    agentId,
    agentTaskId: typeof meta.agentTaskId === 'string' ? meta.agentTaskId : null,
    agentStatus: typeof meta.agentStatus === 'string' ? meta.agentStatus : null,
    agentVerified: typeof meta.agentVerified === 'boolean' ? meta.agentVerified : null,
    verification: parseAgentVerification(row.meta),
    createdAt: row.created_at,
  };
}

function toConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    messageCount: row.message_count,
    agentId: row.agent_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function cleanTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 80);
}

/** Escapes LIKE metacharacters so user text cannot widen a search. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function searchTerms(query: string): string[] {
  return query.replace(/\s+/g, ' ').trim().slice(0, 80).split(' ').filter(Boolean).slice(0, 4);
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
    async listConversations(userId, limit = 50, agentId = undefined) {
      const scoped = agentId === undefined || agentId === null;
      const rows = await db.getAllAsync<ConversationRow>(
        `${CONVERSATION_SELECT}
         WHERE c.user_id = ? ${scoped ? '' : 'AND c.agent_id = ?'}
         ORDER BY c.updated_at DESC, c.id DESC
         LIMIT ?`,
        ...(scoped ? [userId] : [userId, agentId]),
        Math.min(Math.max(limit, 1), 100)
      );

      return rows.map(toConversation);
    },

    getConversation,

    async createConversation(userId, title = 'New chat', agentId = null) {
      const now = Date.now();
      const clean = cleanTitle(title) || 'New chat';
      const cleanAgentId = typeof agentId === 'string' && agentId.trim() ? agentId.trim() : null;

      const result = await db.runAsync(
        `INSERT INTO conversations (user_id, title, agent_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        userId,
        clean,
        cleanAgentId,
        now,
        now
      );

      return {
        id: result.lastInsertRowId,
        userId,
        title: clean,
        messageCount: 0,
        agentId: cleanAgentId,
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

    async searchMessages(userId, conversationId, query, limit = 20) {
      const terms = searchTerms(query);
      if (terms.length === 0) return [];

      const conditions = terms.map(() => `content LIKE ? ESCAPE '\\'`).join(' AND ');
      const patterns = terms.map((term) => `%${escapeLikePattern(term)}%`);
      const rows = await db.getAllAsync<MessageRow>(
        `SELECT id, role, content, meta, created_at
         FROM messages
         WHERE user_id = ? AND conversation_id = ? AND ${conditions}
         ORDER BY id DESC
         LIMIT ?`,
        userId,
        conversationId,
        ...patterns,
        Math.min(Math.max(limit, 1), 20)
      );

      return rows.map(toMessage);
    },

    async addMessage(
      userId,
      conversationId,
      role,
      content,
      traces = [],
      artifacts = [],
      extra: ChatMessageMeta = {}
    ) {
      const conversation = await getConversation(userId, conversationId);

      if (!conversation) {
        throw new Error('Conversation not found.');
      }

      const createdAt = Date.now();
      const metaPayload: ChatMessageMeta = {};

      if (traces.length > 0) {
        metaPayload.traces = traces;
      }

      if (artifacts.length > 0) {
        metaPayload.artifacts = artifacts;
      }

      if (extra.attachments && extra.attachments.length > 0) {
        metaPayload.attachments = extra.attachments;
      }

      if (extra.toolEvents && extra.toolEvents.length > 0) {
        metaPayload.toolEvents = extra.toolEvents;
      }

      if (extra.agentTaskId) {
        metaPayload.agentTaskId = extra.agentTaskId;
      }

      if (extra.agentStatus) {
        metaPayload.agentStatus = extra.agentStatus;
      }

      if (typeof extra.agentVerified === 'boolean') {
        metaPayload.agentVerified = extra.agentVerified;
      }

      if (extra.verification) {
        metaPayload.verification = extra.verification;
      }

      const agentId = extra.agentId ?? conversation.agentId;

      if (agentId) {
        metaPayload.agentId = agentId;
      }

      const meta = Object.keys(metaPayload).length > 0 ? JSON.stringify(metaPayload) : null;

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
        artifacts,
        attachments: metaPayload.attachments ?? [],
        toolEvents: metaPayload.toolEvents ?? [],
        agentId,
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
