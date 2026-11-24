import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

export type AgentToolAccessMode = 'all' | 'selected';

export type AgentConfig = {
  userId: number;
  agentId: string;
  instructions: string;
  memory: string;
  toolAccessMode: AgentToolAccessMode;
  allowedTools: string[];
  createdAt: number;
  updatedAt: number;
};

export type AgentConfigInput = {
  instructions?: string;
  memory?: string;
  toolAccessMode?: AgentToolAccessMode;
  allowedTools?: string[];
};

type AgentConfigRow = {
  user_id: number;
  agent_id: string;
  instructions: string;
  memory: string;
  tool_access_mode: string;
  allowed_tools: string;
  created_at: number;
  updated_at: number;
};

const INSTRUCTIONS_MAX = 4_000;
const MEMORY_MAX = 8_000;
const TOOL_LIMIT = 300;
const TOOL_PATTERN_MAX = 120;
const TOOL_NAME_MAX = 256;

/**
 * Safe built-ins are available by default so a new agent can still answer and
 * manage local tasks. External tools stay opt-in until the user grants them.
 */
const DEFAULT_ALLOWED_TOOLS = [
  'list_tasks',
  'create_task',
  'update_task',
  'complete_task',
  'artifact_read',
  'artifact_list',
  // Read-only discovery and an approval-gated request. Neither can install or
  // grant access without the native plugin approval dialog.
  'orbit_plugin_discover',
  'orbit_plugin_request',
];

function clampText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function normalizeMode(value: unknown): AgentToolAccessMode {
  return value === 'all' ? 'all' : 'selected';
}

function normalizeTools(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const tools = new Set<string>();

  for (const item of value) {
    if (typeof item !== 'string') {
      continue;
    }

    const tool = item.trim().slice(0, TOOL_PATTERN_MAX);

    if (tool) {
      tools.add(tool);
    }

    if (tools.size >= TOOL_LIMIT) {
      break;
    }
  }

  return Array.from(tools).sort((a, b) => a.localeCompare(b));
}

function toConfig(row: AgentConfigRow): AgentConfig {
  let allowed: unknown = [];

  try {
    allowed = JSON.parse(row.allowed_tools) as unknown;
  } catch {
    allowed = [];
  }

  return {
    userId: row.user_id,
    agentId: row.agent_id,
    instructions: row.instructions,
    memory: row.memory,
    toolAccessMode: normalizeMode(row.tool_access_mode),
    allowedTools: normalizeTools(allowed),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function defaultAgentConfig(userId: number, agentId: string): AgentConfig {
  const now = Date.now();

  return {
    userId,
    agentId,
    instructions: '',
    memory: '',
    toolAccessMode: 'selected',
    allowedTools: [...DEFAULT_ALLOWED_TOOLS],
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadAgentConfig(
  db: SQLiteDatabase,
  userId: number,
  agentId: string
): Promise<AgentConfig> {
  const row = await db.getFirstAsync<AgentConfigRow>(
    `SELECT user_id, agent_id, instructions, memory, tool_access_mode,
            allowed_tools, created_at, updated_at
     FROM agent_configs
     WHERE user_id = ? AND agent_id = ?`,
    userId,
    agentId
  );

  return row ? toConfig(row) : defaultAgentConfig(userId, agentId);
}

export async function listAgentConfigs(
  db: SQLiteDatabase,
  userId: number
): Promise<AgentConfig[]> {
  const rows = await db.getAllAsync<AgentConfigRow>(
    `SELECT user_id, agent_id, instructions, memory, tool_access_mode,
            allowed_tools, created_at, updated_at
     FROM agent_configs
     WHERE user_id = ?`,
    userId
  );

  return rows.map(toConfig);
}

export async function saveAgentConfig(
  db: SQLiteDatabase,
  userId: number,
  agentId: string,
  input: AgentConfigInput
): Promise<AgentConfig> {
  const existing = await loadAgentConfig(db, userId, agentId);
  const now = Date.now();
  const config: AgentConfig = {
    ...existing,
    instructions:
      input.instructions === undefined
        ? existing.instructions
        : clampText(input.instructions, INSTRUCTIONS_MAX),
    memory: input.memory === undefined ? existing.memory : clampText(input.memory, MEMORY_MAX),
    toolAccessMode:
      input.toolAccessMode === undefined
        ? existing.toolAccessMode
        : normalizeMode(input.toolAccessMode),
    allowedTools:
      input.allowedTools === undefined ? existing.allowedTools : normalizeTools(input.allowedTools),
    updatedAt: now,
  };

  await db.runAsync(
    `INSERT INTO agent_configs
       (user_id, agent_id, instructions, memory, tool_access_mode, allowed_tools, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, agent_id) DO UPDATE SET
       instructions = excluded.instructions,
       memory = excluded.memory,
       tool_access_mode = excluded.tool_access_mode,
       allowed_tools = excluded.allowed_tools,
       updated_at = excluded.updated_at`,
    userId,
    agentId,
    config.instructions,
    config.memory,
    config.toolAccessMode,
    JSON.stringify(config.allowedTools),
    config.createdAt,
    config.updatedAt
  );

  return config;
}

export async function deleteAgentConfig(
  db: SQLiteDatabase,
  userId: number,
  agentId: string
): Promise<void> {
  await db.runAsync(
    'DELETE FROM agent_configs WHERE user_id = ? AND agent_id = ?',
    userId,
    agentId
  );
}

/**
 * Matches a tool name against a small `*` wildcard pattern without building a
 * regular expression from model/user-controlled input.
 */
export function matchesToolPattern(pattern: string, toolName: string): boolean {
  const clean = pattern.trim();

  if (!clean || clean.length > TOOL_PATTERN_MAX || toolName.length > TOOL_NAME_MAX) {
    return false;
  }

  if (!clean.includes('*')) {
    return clean === toolName;
  }

  const segments = clean.split('*');
  let cursor = 0;
  const last = segments.length - 1;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];

    if (!segment) {
      continue;
    }

    const found = toolName.indexOf(segment, cursor);

    if (found < 0) {
      return false;
    }

    if (index === 0 && found !== 0) {
      return false;
    }

    cursor = found + segment.length;
  }

  if (segments[last] !== '' && cursor !== toolName.length) {
    return false;
  }

  return true;
}

export function isToolAllowedForAgent(config: AgentConfig, toolName: string): boolean {
  if (config.toolAccessMode === 'all') {
    return true;
  }

  return config.allowedTools.some((pattern) => matchesToolPattern(pattern, toolName));
}

export function filterAllowedTools<T extends { name: string }>(
  tools: T[],
  config: AgentConfig
): T[] {
  return tools.filter((tool) => isToolAllowedForAgent(config, tool.name));
}

export function newToolEventId(): string {
  return `tool_${Crypto.randomUUID()}`;
}
