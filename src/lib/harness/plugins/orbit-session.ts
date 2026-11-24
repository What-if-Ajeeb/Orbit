import type { SQLiteDatabase } from 'expo-sqlite';
import { Service, type Context } from 'cordis';

import {
  getChatStore,
  type ChatMessage,
  type ChatMessageMeta,
  type Conversation,
} from '@/lib/chat';

let orbitDb: SQLiteDatabase | null = null;

export function setOrbitDb(db: SQLiteDatabase): void {
  orbitDb = db;
}

function requireDb(): SQLiteDatabase {
  if (!orbitDb) {
    throw new Error('Orbit DB is not set yet.');
  }

  return orbitDb;
}

/**
 * Session persistence plugin. Everything Orbit writes goes through the existing
 * chat-store seam; this class adds the ctx-facing accessors used by the app.
 */
export class OrbitSession extends Service {
  static readonly name = 'session';

  constructor(ctx: Context) {
    super(ctx, 'session');
  }

  async listConversations(
    userId: number,
    limit?: number,
    agentId?: string | null
  ): Promise<Conversation[]> {
    return getChatStore(requireDb()).listConversations(userId, limit, agentId);
  }

  async getConversation(
    userId: number,
    conversationId: number
  ): Promise<Conversation | null> {
    return getChatStore(requireDb()).getConversation(userId, conversationId);
  }

  async createConversation(
    userId: number,
    title?: string,
    agentId?: string | null
  ): Promise<Conversation> {
    const created = await getChatStore(requireDb()).createConversation(userId, title, agentId);
    this.ctx.emit('session/created', { id: created.id, title: created.title, createdAt: created.createdAt });
    return created;
  }

  async listMessages(
    userId: number,
    conversationId: number,
    limit?: number
  ): Promise<ChatMessage[]> {
    return getChatStore(requireDb()).listMessages(userId, conversationId, limit);
  }

  async addMessage(
    userId: number,
    conversationId: number,
    role: 'user' | 'assistant',
    content: string,
    traces: string[] = [],
    meta: ChatMessageMeta = {}
  ): Promise<ChatMessage> {
    return getChatStore(requireDb()).addMessage(
      userId,
      conversationId,
      role,
      content,
      traces,
      [],
      meta
    );
  }

  async deleteConversation(userId: number, conversationId: number): Promise<void> {
    await getChatStore(requireDb()).deleteConversation(userId, conversationId);
    this.ctx.emit('session/deleted', conversationId);
  }

  async clearAllChat(userId: number): Promise<void> {
    await getChatStore(requireDb()).clearAllChat(userId);
  }
}
