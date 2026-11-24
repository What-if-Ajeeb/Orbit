import type { SQLiteDatabase } from 'expo-sqlite';

import {
  createSqliteChatStore,
  type ChatMessageMeta,
  type ChatRole,
  type ChatStore,
} from './chat-store';
import type { ArtifactRef } from './artifacts/types';

export type {
  ChatAttachment,
  ChatMessage,
  ChatMessageMeta,
  ChatRole,
  ChatStore,
  Conversation,
  ToolExecutionEvent,
  ToolExecutionStatus,
} from './chat-store';
export type { ArtifactRef } from './artifacts/types';
export { createSqliteChatStore } from './chat-store';

/**
 * A chat store plugin owns conversation persistence. SQLite is registered as
 * the default; an add-on can register another store and activate it without
 * touching the screens or the agent.
 */
export type ChatStorePlugin = {
  id: string;
  label: string;
  description: string;
  create: (db: SQLiteDatabase) => ChatStore;
};

type RegisterChatStoreOptions = {
  /** Replace a plugin with the same id instead of throwing. */
  replace?: boolean;
  /** Make this plugin the active store for new lookups. */
  activate?: boolean;
};

const chatStorePlugins = new Map<string, ChatStorePlugin>();
const stores = new WeakMap<
  SQLiteDatabase,
  { pluginId: string; revision: number; store: ChatStore }
>();
let activeChatStoreId = '';
let chatStoreRevision = 0;

export function registerChatStorePlugin(
  plugin: ChatStorePlugin,
  options: RegisterChatStoreOptions = {}
): void {
  const id = plugin.id.trim();

  if (!id) {
    throw new Error('A chat store plugin needs a non-empty id.');
  }

  if (!options.replace && chatStorePlugins.has(id)) {
    throw new Error(`Chat store plugin "${id}" is already registered.`);
  }

  chatStorePlugins.set(id, { ...plugin, id });
  chatStoreRevision += 1;

  if (options.activate || !chatStorePlugins.has(activeChatStoreId)) {
    activeChatStoreId = id;
  }
}

export function listChatStorePlugins(): ChatStorePlugin[] {
  return Array.from(chatStorePlugins.values(), (plugin) => ({ ...plugin }));
}

export function getActiveChatStoreId(): string {
  return activeChatStoreId;
}

export function setActiveChatStore(id: string): void {
  if (!chatStorePlugins.has(id)) {
    throw new Error(`Chat store plugin "${id}" is not registered.`);
  }

  activeChatStoreId = id;
  chatStoreRevision += 1;
}

registerChatStorePlugin({
  id: 'sqlite',
  label: 'SQLite',
  description: 'Conversations and messages stay on this device.',
  create: createSqliteChatStore,
});

/**
 * Resolves the conversation store for a database instance. Screens depend on
 * the ChatStore interface, so a different provider can be swapped in later.
 */
export function getChatStore(db: SQLiteDatabase): ChatStore {
  const plugin = chatStorePlugins.get(activeChatStoreId);

  if (!plugin) {
    throw new Error('No chat store plugin is active.');
  }

  const cached = stores.get(db);

  if (
    cached &&
    cached.pluginId === activeChatStoreId &&
    cached.revision === chatStoreRevision
  ) {
    return cached.store;
  }

  const store = plugin.create(db);
  stores.set(db, {
    pluginId: activeChatStoreId,
    revision: chatStoreRevision,
    store,
  });
  return store;
}

// Function wrappers keep older call sites on the same seam. New code can use
// getChatStore(db) directly.
export function listConversations(
  db: SQLiteDatabase,
  userId: number,
  limit = 50,
  agentId?: string | null
) {
  return getChatStore(db).listConversations(userId, limit, agentId);
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
  title = 'New chat',
  agentId?: string | null
) {
  return getChatStore(db).createConversation(userId, title, agentId);
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
  traces: string[] = [],
  artifacts: ArtifactRef[] = [],
  meta: ChatMessageMeta = {}
) {
  return getChatStore(db).addMessage(
    userId,
    conversationId,
    role,
    content,
    traces,
    artifacts,
    meta
  );
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
