import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'orbit.db';

/**
 * Creates the local-only backend schema. Everything (accounts, sessions,
 * tasks and the agent conversation) lives in SQLite on the device.
 */
export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  const DATABASE_VERSION = 8;

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

  if (currentDbVersion === 6) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS permission_agents (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        description TEXT NOT NULL,
        icon TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_permission_agents_user
        ON permission_agents (user_id);

      CREATE TABLE IF NOT EXISTS permission_requests (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        agent_role TEXT NOT NULL,
        category TEXT NOT NULL,
        risk TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        project_id TEXT NOT NULL,
        project_label TEXT NOT NULL,
        conversation_id INTEGER,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        actions TEXT NOT NULL,
        target TEXT NOT NULL,
        reason TEXT NOT NULL,
        command_preview TEXT,
        scope_key TEXT NOT NULL,
        allow_always INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL,
        resolution TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        resolved_at INTEGER,
        metadata TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_permission_requests_user_created
        ON permission_requests (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_permission_requests_status
        ON permission_requests (status);
      CREATE INDEX IF NOT EXISTS idx_permission_requests_agent
        ON permission_requests (agent_id);

      CREATE TABLE IF NOT EXISTS permission_grants (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        request_id TEXT,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        category TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        project_id TEXT NOT NULL,
        project_label TEXT NOT NULL,
        scope TEXT NOT NULL,
        risk TEXT NOT NULL,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        last_used_at INTEGER,
        use_count INTEGER NOT NULL DEFAULT 0,
        max_uses INTEGER,
        revoked_at INTEGER,
        status TEXT NOT NULL DEFAULT 'active',
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_permission_grants_user_status
        ON permission_grants (user_id, status);
      CREATE INDEX IF NOT EXISTS idx_permission_grants_scope
        ON permission_grants (
          user_id, agent_id, tool_name, category, project_id, scope_key, status
        );

      CREATE TABLE IF NOT EXISTS permission_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        request_id TEXT,
        grant_id TEXT,
        agent_id TEXT,
        event TEXT NOT NULL,
        category TEXT,
        risk TEXT,
        tool_name TEXT,
        project_id TEXT,
        detail TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_permission_audit_user_created
        ON permission_audit (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_permission_audit_request
        ON permission_audit (request_id);

      CREATE TABLE IF NOT EXISTS paired_devices (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        platform TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'paired',
        capabilities TEXT NOT NULL,
        paired_at INTEGER NOT NULL,
        last_seen_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_paired_devices_user_status
        ON paired_devices (user_id, status);

      CREATE TABLE IF NOT EXISTS permission_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    currentDbVersion = 7;
  }

  if (currentDbVersion === 7) {
    // Phase 1: Buddy System tables
    await db.execAsync(`
      -- User's owned buddies + progression
      CREATE TABLE IF NOT EXISTS user_buddies (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        species_id TEXT NOT NULL,          -- e.g. 'fox', 'raven'
        nickname TEXT,                   -- optional custom name (default = species name)
        current_form_id TEXT NOT NULL,   -- e.g. 'fox_base', 'fox_aether'
        level INTEGER NOT NULL DEFAULT 1,
        xp INTEGER NOT NULL DEFAULT 0,
        bond INTEGER NOT NULL DEFAULT 0,  -- 0-100
        is_active INTEGER NOT NULL DEFAULT 0, -- only one active at a time
        unlocked_forms TEXT NOT NULL DEFAULT '[]', -- JSON array of form_ids
        stats_override TEXT,             -- optional JSON for custom stats
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_interacted_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_user_buddies_user
        ON user_buddies (user_id);
      CREATE INDEX IF NOT EXISTS idx_user_buddies_active
        ON user_buddies (user_id, is_active);
      CREATE INDEX IF NOT EXISTS idx_user_buddies_species
        ON user_buddies (user_id, species_id);

      -- Evolution history / log
      CREATE TABLE IF NOT EXISTS buddy_evolution_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        user_buddy_id TEXT NOT NULL,
        from_form_id TEXT NOT NULL,
        to_form_id TEXT NOT NULL,
        level_at INTEGER NOT NULL,
        bond_at INTEGER NOT NULL,
        method TEXT NOT NULL,              -- 'level', 'item', 'bond', 'event', 'branch'
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (user_buddy_id) REFERENCES user_buddies (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_buddy_evolution_log_user
        ON buddy_evolution_log (user_id, created_at DESC);

      -- Simple inventory for evolution items (Core, Orb, etc.)
      CREATE TABLE IF NOT EXISTS buddy_inventory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        item_id TEXT NOT NULL,             -- 'evolution_core', 'spirit_orb', 'mythic_shard'...
        quantity INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        UNIQUE(user_id, item_id),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_buddy_inventory_user
        ON buddy_inventory (user_id);
    `);

    currentDbVersion = 8;
  }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}
