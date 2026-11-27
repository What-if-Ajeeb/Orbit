import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'orbit.db';

/**
 * Creates the local-only backend schema. Everything (accounts, sessions,
 * tasks and the agent conversation) lives in SQLite on the device.
 */
export async function migrateDbIfNeeded(db: SQLiteDatabase): Promise<void> {
  const DATABASE_VERSION = 16;

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

  if (currentDbVersion === 8) {
    // Workflows: saved, reusable instructions the agent can run on demand.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS workflows (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        instruction TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_workflows_user_updated
        ON workflows (user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS workflow_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        workflow_id INTEGER NOT NULL,
        conversation_id INTEGER,
        status TEXT NOT NULL DEFAULT 'running',
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        summary TEXT NOT NULL DEFAULT '',
        traces TEXT NOT NULL DEFAULT '[]',
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (workflow_id) REFERENCES workflows (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_workflow_runs_user_started
        ON workflow_runs (user_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow
        ON workflow_runs (workflow_id, id DESC);
    `);

    currentDbVersion = 9;
  }

  if (currentDbVersion === 9) {
    // Artifacts: substantial self-contained content produced by the agent.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        conversation_id INTEGER,
        title TEXT NOT NULL,
        type TEXT NOT NULL,
        language TEXT,
        current_version INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE SET NULL
      );

      CREATE INDEX IF NOT EXISTS idx_artifacts_user_updated
        ON artifacts (user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS artifact_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        artifact_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        content TEXT NOT NULL,
        summary TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (artifact_id) REFERENCES artifacts (id) ON DELETE CASCADE,
        UNIQUE (artifact_id, version)
      );

      CREATE INDEX IF NOT EXISTS idx_artifact_versions_artifact_version
        ON artifact_versions (artifact_id, version DESC);
    `);

    currentDbVersion = 10;
  }

  if (currentDbVersion === 10) {
    await db.execAsync(`
      ALTER TABLE user_buddies ADD COLUMN mood TEXT NOT NULL DEFAULT 'calm';

      CREATE TABLE IF NOT EXISTS buddy_activity_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        user_buddy_id TEXT NOT NULL,
        activity TEXT NOT NULL,
        xp_gained INTEGER NOT NULL DEFAULT 0,
        bond_gained INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (user_buddy_id) REFERENCES user_buddies (id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_buddy_activity_log_user
        ON buddy_activity_log (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_buddy_activity_log_buddy
        ON buddy_activity_log (user_buddy_id, created_at DESC);
    `);

    currentDbVersion = 11;
  }

  if (currentDbVersion === 11) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS plugin_records (
        plugin_id TEXT PRIMARY KEY NOT NULL,
        name TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest TEXT NOT NULL,
        trust_level TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        installed_at INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL DEFAULT 0,
        last_started_at INTEGER,
        last_stopped_at INTEGER,
        error TEXT,
        health_json TEXT,
        data_schema_version INTEGER NOT NULL DEFAULT 1,
        legacy INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_records_status
        ON plugin_records (status, enabled);
      CREATE INDEX IF NOT EXISTS idx_plugin_records_legacy
        ON plugin_records (legacy);

      CREATE TABLE IF NOT EXISTS plugin_versions (
        plugin_id TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest TEXT NOT NULL,
        source TEXT NOT NULL,
        installed_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, version),
        FOREIGN KEY (plugin_id) REFERENCES plugin_records (plugin_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS plugin_dependencies (
        plugin_id TEXT NOT NULL,
        dependency_id TEXT NOT NULL,
        version_range TEXT NOT NULL,
        optional INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (plugin_id, dependency_id),
        FOREIGN KEY (plugin_id) REFERENCES plugin_records (plugin_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS plugin_permissions (
        plugin_id TEXT NOT NULL,
        permission TEXT NOT NULL,
        granted INTEGER NOT NULL DEFAULT 0,
        source TEXT NOT NULL,
        granted_at INTEGER NOT NULL DEFAULT 0,
        revoked_at INTEGER,
        PRIMARY KEY (plugin_id, permission)
      );

      CREATE TABLE IF NOT EXISTS plugin_permission_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_id TEXT NOT NULL,
        event TEXT NOT NULL,
        permissions TEXT NOT NULL,
        source TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_permission_audit_plugin
        ON plugin_permission_audit (plugin_id, id DESC);

      CREATE TABLE IF NOT EXISTS plugin_install_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_id TEXT NOT NULL,
        action TEXT NOT NULL,
        from_version TEXT,
        to_version TEXT,
        status TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_install_history_plugin
        ON plugin_install_history (plugin_id, id DESC);
      CREATE INDEX IF NOT EXISTS idx_plugin_install_history_created
        ON plugin_install_history (created_at DESC);

      CREATE TABLE IF NOT EXISTS plugin_settings (
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (plugin_id, key)
      );

      CREATE TABLE IF NOT EXISTS plugin_kv (
        plugin_id TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        bytes INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (plugin_id, key)
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_kv_plugin
        ON plugin_kv (plugin_id);

      CREATE TABLE IF NOT EXISTS plugin_backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        plugin_id TEXT NOT NULL,
        from_version TEXT NOT NULL,
        to_version TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_backups_plugin
        ON plugin_backups (plugin_id, id DESC);

      CREATE TABLE IF NOT EXISTS plugin_meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);

    currentDbVersion = 12;
  }

  // Agent chat v13: conversations are owned by an agent, and per-agent
  // instructions/tool access live in the same encrypted-on-device SQLite DB.
  if (currentDbVersion === 12) {
    const conversationColumns = await db.getAllAsync<{ name: string }>(
      'PRAGMA table_info(conversations)'
    );
    const hasAgentId = conversationColumns.some((column) => column.name === 'agent_id');

    // One transaction keeps the column, backfill, and supporting tables in
    // lockstep. A crash mid-migration must not leave agent_id NULL forever.
    await db.withTransactionAsync(async () => {
      if (!hasAgentId) {
        await db.execAsync(`
          ALTER TABLE conversations ADD COLUMN agent_id TEXT;
          UPDATE conversations SET agent_id = 'master' WHERE agent_id IS NULL;
        `);
      }

      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS agent_configs (
          user_id INTEGER NOT NULL,
          agent_id TEXT NOT NULL,
          instructions TEXT NOT NULL DEFAULT '',
          memory TEXT NOT NULL DEFAULT '',
          tool_access_mode TEXT NOT NULL DEFAULT 'selected',
          allowed_tools TEXT NOT NULL DEFAULT '[]',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (user_id, agent_id),
          FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_agent_configs_user
          ON agent_configs (user_id);

        CREATE INDEX IF NOT EXISTS idx_conversations_user_agent
          ON conversations (user_id, agent_id, updated_at DESC);
      `);
    });

    currentDbVersion = 13;
  }

  // Agent Safety v14: scoped/expiring grants, persistent denials, a hash-linked
  // activity journal, real trash entries and cancellable operation tracking.
  if (currentDbVersion === 13) {
    await db.execAsync(`
      ALTER TABLE permission_requests ADD COLUMN resource_key TEXT NOT NULL DEFAULT '';
      ALTER TABLE permission_requests ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';
      ALTER TABLE permission_requests ADD COLUMN fresh_confirmation INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE permission_requests ADD COLUMN reversible INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE permission_requests ADD COLUMN external INTEGER NOT NULL DEFAULT 0;

      ALTER TABLE permission_grants ADD COLUMN resource_key TEXT NOT NULL DEFAULT '';
      ALTER TABLE permission_grants ADD COLUMN fingerprint TEXT NOT NULL DEFAULT '';
      ALTER TABLE permission_grants ADD COLUMN session_id TEXT NOT NULL DEFAULT '';
      ALTER TABLE permission_grants ADD COLUMN choice TEXT NOT NULL DEFAULT 'always_allow';
      ALTER TABLE permission_grants ADD COLUMN narrow INTEGER NOT NULL DEFAULT 1;

      CREATE TABLE IF NOT EXISTS permission_denials (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        category TEXT NOT NULL,
        project_id TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        resource_key TEXT NOT NULL DEFAULT '',
        reason TEXT NOT NULL DEFAULT 'never_allow',
        created_at INTEGER NOT NULL,
        revoked_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_permission_denials_scope
        ON permission_denials (user_id, agent_id, tool_name, category, project_id, scope_key);
      CREATE INDEX IF NOT EXISTS idx_permission_denials_user
        ON permission_denials (user_id, revoked_at);

      CREATE TABLE IF NOT EXISTS permission_preferences (
        user_id INTEGER NOT NULL,
        agent_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        category TEXT NOT NULL,
        project_id TEXT NOT NULL,
        scope_key TEXT NOT NULL,
        resource_key TEXT NOT NULL DEFAULT '',
        choice TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        revoked_at INTEGER,
        PRIMARY KEY (user_id, agent_id, tool_name, category, project_id, scope_key, resource_key),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_permission_preferences_user
        ON permission_preferences (user_id, revoked_at);

      CREATE TABLE IF NOT EXISTS agent_activity (
        id TEXT PRIMARY KEY,
        sequence INTEGER NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        conversation_id INTEGER,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_key TEXT NOT NULL DEFAULT '',
        resource_label TEXT NOT NULL DEFAULT '',
        permission_used TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        result TEXT NOT NULL DEFAULT '',
        error TEXT NOT NULL DEFAULT '',
        category TEXT,
        risk TEXT,
        request_id TEXT,
        grant_id TEXT,
        reversible INTEGER NOT NULL DEFAULT 0,
        external INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        metadata TEXT NOT NULL DEFAULT '{}',
        previous_hash TEXT NOT NULL DEFAULT '',
        hash TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_activity_user_created
        ON agent_activity (user_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_activity_conversation
        ON agent_activity (user_id, conversation_id, sequence DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_activity_request
        ON agent_activity (request_id);

      CREATE TABLE IF NOT EXISTS trash_items (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        conversation_id INTEGER,
        agent_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        original_path TEXT NOT NULL,
        stored_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER NOT NULL DEFAULT 0,
        mime_type TEXT NOT NULL DEFAULT '',
        metadata TEXT NOT NULL DEFAULT '{}',
        deleted_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        restored_at INTEGER,
        purged_at INTEGER,
        status TEXT NOT NULL DEFAULT 'trashed',
        failure_reason TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_trash_items_user_status
        ON trash_items (user_id, status, deleted_at DESC);
      CREATE INDEX IF NOT EXISTS idx_trash_items_expiry
        ON trash_items (status, expires_at);

      CREATE TABLE IF NOT EXISTS active_operations (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        conversation_id INTEGER,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        cancellable INTEGER NOT NULL DEFAULT 0,
        external INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        detail TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_active_operations_user
        ON active_operations (user_id, status, started_at DESC);
    `);

    currentDbVersion = 14;
  }

  // Agent Action Cards v15: typed, idempotent action drafts with explicit
  // approval state and real execution results. Sensitive execution still goes
  // through the existing permission executor and activity journal.
  if (currentDbVersion === 14) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS agent_actions (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        conversation_id INTEGER,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        kind TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        title TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT '',
        payload TEXT NOT NULL DEFAULT '{}',
        tool_args TEXT NOT NULL DEFAULT '{}',
        fingerprint TEXT NOT NULL,
        permission_request_id TEXT,
        risk TEXT NOT NULL DEFAULT 'medium',
        category TEXT NOT NULL DEFAULT 'background_automation',
        approval_fingerprint TEXT,
        approved_at INTEGER,
        result TEXT,
        error TEXT,
        trace TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_actions_user_updated
        ON agent_actions (user_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_actions_conversation
        ON agent_actions (user_id, conversation_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_actions_status
        ON agent_actions (user_id, status);
    `);

    currentDbVersion = 15;
  }

  // Autonomous Agent v16: durable orchestration state. The existing task list,
  // workflows, skills and subagent definitions are preserved; these tables add
  // recoverable turn/subagent state, scoped memory, versioned skill manifests,
  // explicit delegation grants and persistent background triggers.
  if (currentDbVersion === 15) {
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        conversation_id INTEGER,
        project_id TEXT NOT NULL DEFAULT 'orbit-workspace',
        parent_task_id TEXT,
        subagent_id TEXT,
        kind TEXT NOT NULL DEFAULT 'turn',
        title TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'queued',
        phase TEXT NOT NULL DEFAULT 'system',
        input_json TEXT NOT NULL DEFAULT '{}',
        result_json TEXT,
        verification_json TEXT,
        error TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 2,
        priority INTEGER NOT NULL DEFAULT 0,
        idempotency_key TEXT,
        lease_owner TEXT,
        lease_until INTEGER,
        budget_json TEXT NOT NULL DEFAULT '{}',
        grants_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        started_at INTEGER,
        finished_at INTEGER,
        next_run_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES conversations (id) ON DELETE SET NULL,
        FOREIGN KEY (parent_task_id) REFERENCES agent_tasks (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_user_status
        ON agent_tasks (user_id, status, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_conversation
        ON agent_tasks (user_id, conversation_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_parent
        ON agent_tasks (parent_task_id);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_lease
        ON agent_tasks (status, lease_until);
      CREATE INDEX IF NOT EXISTS idx_agent_tasks_idempotency
        ON agent_tasks (user_id, idempotency_key);

      CREATE TABLE IF NOT EXISTS agent_task_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        sequence INTEGER NOT NULL UNIQUE,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL,
        previous_hash TEXT NOT NULL DEFAULT '',
        hash TEXT NOT NULL,
        FOREIGN KEY (task_id) REFERENCES agent_tasks (id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_task_events_task
        ON agent_task_events (task_id, sequence);
      CREATE INDEX IF NOT EXISTS idx_agent_task_events_user
        ON agent_task_events (user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS agent_task_attempts (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        tool_name TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error_code TEXT,
        error TEXT,
        verification TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        FOREIGN KEY (task_id) REFERENCES agent_tasks (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_task_attempts_task
        ON agent_task_attempts (task_id, attempt, started_at);

      CREATE TABLE IF NOT EXISTS agent_task_schedules (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        task_id TEXT,
        title TEXT NOT NULL DEFAULT '',
        input_json TEXT NOT NULL DEFAULT '{}',
        enabled INTEGER NOT NULL DEFAULT 1,
        interval_ms INTEGER,
        next_run_at INTEGER NOT NULL,
        last_run_at INTEGER,
        lease_owner TEXT,
        lease_until INTEGER,
        idempotency_key TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES agent_tasks (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_agent_task_schedules_due
        ON agent_task_schedules (enabled, next_run_at, lease_until);
      CREATE INDEX IF NOT EXISTS idx_agent_task_schedules_owner
        ON agent_task_schedules (user_id, owner_type, owner_id);

      CREATE TABLE IF NOT EXISTS agent_memory (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        agent_id TEXT NOT NULL DEFAULT 'master',
        project_key TEXT NOT NULL DEFAULT '',
        project_id TEXT,
        scope TEXT NOT NULL DEFAULT 'agent',
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'agent',
        confidence REAL NOT NULL DEFAULT 1,
        version INTEGER NOT NULL DEFAULT 1,
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        UNIQUE (user_id, agent_id, project_key, scope, key)
      );
      CREATE INDEX IF NOT EXISTS idx_agent_memory_scope
        ON agent_memory (user_id, agent_id, project_key, scope, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_agent_memory_expiry
        ON agent_memory (expires_at);

      CREATE TABLE IF NOT EXISTS skill_versions (
        skill_id TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'builtin',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (skill_id, version),
        FOREIGN KEY (skill_id) REFERENCES skills (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_skill_versions_skill
        ON skill_versions (skill_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS subagent_grants (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        parent_task_id TEXT NOT NULL,
        subagent_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT '',
        resource_key TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        expires_at INTEGER,
        created_at INTEGER NOT NULL,
        revoked_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        FOREIGN KEY (parent_task_id) REFERENCES agent_tasks (id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_subagent_grants_task
        ON subagent_grants (parent_task_id, status);
      CREATE INDEX IF NOT EXISTS idx_subagent_grants_tool
        ON subagent_grants (user_id, subagent_id, tool_name, status);
    `);

    // Existing workflow history stays readable; each run can now point at its
    // durable orchestration task and the schedule that triggered it.
    const runColumns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(workflow_runs)');
    if (!runColumns.some((column) => column.name === 'agent_task_id')) {
      await db.execAsync('ALTER TABLE workflow_runs ADD COLUMN agent_task_id TEXT');
    }
    if (!runColumns.some((column) => column.name === 'schedule_id')) {
      await db.execAsync('ALTER TABLE workflow_runs ADD COLUMN schedule_id TEXT');
    }
    await db.execAsync(`
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_agent_task
        ON workflow_runs (agent_task_id);
      CREATE INDEX IF NOT EXISTS idx_workflow_runs_schedule
        ON workflow_runs (schedule_id);
    `);

    currentDbVersion = 16;
  }

  if (currentDbVersion !== DATABASE_VERSION) {
    throw new Error(`Database migration ended at version ${currentDbVersion}, expected ${DATABASE_VERSION}.`);
  }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}
