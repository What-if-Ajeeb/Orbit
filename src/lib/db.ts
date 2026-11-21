import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'orbit.db';

/**
 * Creates the local-only backend schema. Everything (accounts, sessions,
 * tasks and the agent conversation) lives in SQLite on the device.
 */
export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  const DATABASE_VERSION = 6;

  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let currentDbVersion = result?.user_version ?? 0;

  if (currentDbVersion >= DATABASE_VERSION) {
    return;
  }

  if (currentDbVersion === 0) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions (token_hash);
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id);
    `);

    currentDbVersion = 1;
  }

  if (currentDbVersion === 1) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        notes TEXT,
        due_at INTEGER,
        remind_at INTEGER,
        priority TEXT NOT NULL DEFAULT 'normal',
        status TEXT NOT NULL DEFAULT 'open',
        notification_id TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_tasks_user_status_due
        ON tasks (user_id, status, due_at);

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        meta TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_messages_user_created
        ON messages (user_id, created_at);
    `);

    currentDbVersion = 2;
  }

  if (currentDbVersion === 2) {
    const messageColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(messages)');
    const hasConversationId = messageColumns.some(
      (column) => column.name === 'conversation_id'
    );

    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
        ON conversations (user_id, updated_at DESC);
    `);

    if (!hasConversationId) {
      await db.execAsync(`
        ALTER TABLE messages ADD COLUMN conversation_id INTEGER
          REFERENCES conversations (id) ON DELETE CASCADE;
      `);
    }

    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
        ON messages (conversation_id, id);

      INSERT INTO conversations (user_id, title, created_at, updated_at)
      SELECT m.user_id, 'Earlier chat', MIN(m.created_at), MAX(m.created_at)
      FROM messages m
      WHERE NOT EXISTS (
        SELECT 1 FROM conversations c WHERE c.user_id = m.user_id
      )
      GROUP BY m.user_id;

      UPDATE messages
      SET conversation_id = (
        SELECT c.id
        FROM conversations c
        WHERE c.user_id = messages.user_id
        ORDER BY c.id ASC
        LIMIT 1
      )
      WHERE conversation_id IS NULL;
    `);

    currentDbVersion = 3;
  }

  if (currentDbVersion === 3) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        sequence_number INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_events_conversation_sequence
        ON events (conversation_id, sequence_number);
      CREATE INDEX IF NOT EXISTS idx_events_type
        ON events (type);
      CREATE INDEX IF NOT EXISTS idx_events_created
        ON events (created_at);
    `);

    currentDbVersion = 4;
  }

  if (currentDbVersion === 4) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS plugins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        code TEXT NOT NULL,
        config TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_plugins_type_enabled
        ON plugins (type, enabled);

      CREATE TABLE IF NOT EXISTS overlays (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slot TEXT NOT NULL,
        name TEXT NOT NULL,
        code TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_overlays_slot_enabled
        ON overlays (slot, enabled);
    `);

    currentDbVersion = 5;
  }

  if (currentDbVersion === 5) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        version TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        auto_load INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS hooks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        hook_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        code TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_hooks_type_enabled
        ON hooks (hook_type, enabled);

      CREATE TABLE IF NOT EXISTS subagents (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        version TEXT NOT NULL,
        capabilities TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS subagent_tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        input TEXT NOT NULL,
        output TEXT,
        error TEXT,
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        completed_at INTEGER,
        parent_conversation_id INTEGER,
        agent_id TEXT,
        FOREIGN KEY (parent_conversation_id) REFERENCES conversations (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_subagent_tasks_parent
        ON subagent_tasks (parent_conversation_id);
      CREATE INDEX IF NOT EXISTS idx_subagent_tasks_status
        ON subagent_tasks (status);
    `);

    currentDbVersion = 6;
  }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}
