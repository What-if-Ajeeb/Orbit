import type { SQLiteDatabase } from 'expo-sqlite';

import { createSqliteChatStore, type ChatRole, type ChatStore } from './chat-store';

export type {
  ChatMessage,
  ChatRole,
  ChatStore,
  Conversation,
} from './chat-store';
export { createSqliteChatStore } from './chat-store';

const stores = new WeakMap<SQLiteDatabase, ChatStore>();

/**
 * Resolves the conversation store for a database instance. Screens depend on
 * the ChatStore interface, so a different provider can be swapped in later.
 */
export function getChatStore(db: SQLiteDatabase): ChatStore {
  let store = stores.get(db);

  if (!store) {
    store = createSqliteChatStore(db);
    stores.set(db, store);
  }

  return store;
}

// Function wrappers keep older call sites on the same seam. New code can use
// getChatStore(db) directly.
export function listConversations(db: SQLiteDatabase, userId: number, limit = 50) {
  return getChatStore(db).listConversations(userId, limit);
}

export function getConversation(
  db: SQLiteDatabase,
  userId: number,
  conversationId: number
) {
  return getChatStore(db).getConversation(userId, conversationId);
}

export function createConversation(
  db: SQLiteDatabase,
  userId: number,
  title = 'New chat'
) {
  return getChatStore(db).createConversation(userId, title);
}

export function listMessages(
  db: SQLiteDatabase,
  userId: number,
  conversationId: number,
  limit = 100
) {
  return getChatStore(db).listMessages(userId, conversationId, limit);
}

export function addMessage(
  db: SQLiteDatabase,
  userId: number,
  conversationId: number,
  role: ChatRole,
  content: string,
  traces: string[] = []
) {
  return getChatStore(db).addMessage(userId, conversationId, role, content, traces);
}

export function deleteConversation(
  db: SQLiteDatabase,
  userId: number,
  conversationId: number
) {
  return getChatStore(db).deleteConversation(userId, conversationId);
}

export function clearAllChat(db: SQLiteDatabase, userId: number) {
  return getChatStore(db).clearAllChat(userId);
}
