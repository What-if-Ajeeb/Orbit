import type { SQLiteDatabase } from 'expo-sqlite';

export type PluginType = 'tool' | 'overlay' | 'provider' | 'storage';

export type Plugin = {
  id: number;
  name: string;
  type: PluginType;
  code: string;
  config: Record<string, unknown> | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Overlay = {
  id: number;
  slot: string;
  name: string;
  code: string;
  enabled: boolean;
  createdAt: number;
};

type PluginRow = {
  id: number;
  name: string;
  type: string;
  code: string;
  config: string | null;
  enabled: number;
  createdAt: number;
  updatedAt: number;
};

type OverlayRow = {
  id: number;
  slot: string;
  name: string;
  code: string;
  enabled: number;
  createdAt: number;
};

/**
 * Persistent storage for user-authored plugins and UI overlays. Everything is
 * stored in SQLite on the device; nothing is sent to a server.
 */
export class PluginStore {
  constructor(private db: SQLiteDatabase) {}

  async listPlugins(): Promise<Plugin[]> {
    const rows = (await this.db.getAllAsync(
      `SELECT id, name, type, code, config, enabled, created_at AS createdAt,
              updated_at AS updatedAt
       FROM plugins
       ORDER BY created_at DESC`
    )) as PluginRow[];
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      type: row.type as PluginType,
      code: row.code,
      config: row.config ? JSON.parse(row.config) : null,
      enabled: row.enabled === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  async getPlugin(id: number): Promise<Plugin | null> {
    const row = (await this.db.getFirstAsync(
      `SELECT id, name, type, code, config, enabled, created_at AS createdAt,
              updated_at AS updatedAt
       FROM plugins
       WHERE id = ?`,
      id
    )) as PluginRow | null;
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      name: row.name,
      type: row.type as PluginType,
      code: row.code,
      config: row.config ? JSON.parse(row.config) : null,
      enabled: row.enabled === 1,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async createPlugin(input: {
    name: string;
    type: PluginType;
    code: string;
    config?: Record<string, unknown>;
  }): Promise<Plugin> {
    const now = Date.now();
    const config = input.config ?? null;
    const result = await this.db.runAsync(
      `INSERT INTO plugins (name, type, code, config, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      input.name,
      input.type,
      input.code,
      config ? JSON.stringify(config) : null,
      now,
      now
    );
    const id = (result.lastInsertRowId as number) ?? 0;
    return {
      id,
      name: input.name,
      type: input.type,
      code: input.code,
      config,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };
  }

  async updatePlugin(id: number, patch: Partial<Plugin>): Promise<void> {
    const fields: string[] = [];
    const values: (string | number)[] = [];

    if (patch.name !== undefined) {
      fields.push('name = ?');
      values.push(patch.name);
    }
    if (patch.type !== undefined) {
      fields.push('type = ?');
      values.push(patch.type);
    }
    if (patch.code !== undefined) {
      fields.push('code = ?');
      values.push(patch.code);
    }
    if (patch.config !== undefined) {
      fields.push('config = ?');
      values.push(patch.config ? JSON.stringify(patch.config) : (null as unknown as string | number));
    }
    if (patch.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(patch.enabled ? 1 : 0);
    }
    if (fields.length === 0) {
      return;
    }

    fields.push('updated_at = ?');
    values.push(Date.now());
    values.push(id);

    await this.db.runAsync(
      `UPDATE plugins SET ${fields.join(', ')} WHERE id = ?`,
      ...values
    );
  }

  async deletePlugin(id: number): Promise<void> {
    await this.db.runAsync('DELETE FROM plugins WHERE id = ?', id);
  }

  async setPluginEnabled(id: number, enabled: boolean): Promise<void> {
    await this.db.runAsync(
      `UPDATE plugins SET enabled = ?, updated_at = ? WHERE id = ?`,
      enabled ? 1 : 0,
      Date.now(),
      id
    );
  }

  async listOverlays(slot?: string): Promise<Overlay[]> {
    if (slot) {
      const rows = (await this.db.getAllAsync(
        `SELECT id, slot, name, code, enabled, created_at AS createdAt
         FROM overlays
         WHERE slot = ?
         ORDER BY created_at DESC`,
        slot
      )) as OverlayRow[];
      return rows.map((row) => ({
        id: row.id,
        slot: row.slot,
        name: row.name,
        code: row.code,
        enabled: row.enabled === 1,
        createdAt: row.createdAt,
      }));
    }
    const rows = (await this.db.getAllAsync(
      `SELECT id, slot, name, code, enabled, created_at AS createdAt
       FROM overlays
       ORDER BY slot, created_at DESC`
    )) as OverlayRow[];
    return rows.map((row) => ({
      id: row.id,
      slot: row.slot,
      name: row.name,
      code: row.code,
      enabled: row.enabled === 1,
      createdAt: row.createdAt,
    }));
  }

  async createOverlay(input: {
    slot: string;
    name: string;
    code: string;
  }): Promise<Overlay> {
    const now = Date.now();
    const result = await this.db.runAsync(
      `INSERT INTO overlays (slot, name, code, enabled, created_at)
       VALUES (?, ?, ?, 1, ?)`,
      input.slot,
      input.name,
      input.code,
      now
    );
    const id = (result.lastInsertRowId as number) ?? 0;
    return {
      id,
      slot: input.slot,
      name: input.name,
      code: input.code,
      enabled: true,
      createdAt: now,
    };
  }

  async deleteOverlay(id: number): Promise<void> {
    await this.db.runAsync('DELETE FROM overlays WHERE id = ?', id);
  }

  async setOverlayEnabled(id: number, enabled: boolean): Promise<void> {
    await this.db.runAsync(
      `UPDATE overlays SET enabled = ? WHERE id = ?`,
      enabled ? 1 : 0,
      id
    );
  }
}
