import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { AgentIdentity, AgentRole } from './types';

export const MASTER_AGENT: AgentIdentity = {
  id: 'master',
  name: 'Master Agent',
  role: 'master',
  description: 'Coordinates the user’s request and delegates work to specialist agents.',
  icon: 'planet',
};

export const SPECIALIST_AGENTS: AgentIdentity[] = [
  {
    id: 'developer',
    name: 'Developer Agent',
    role: 'specialist',
    description: 'Builds, tests, and changes software projects.',
    icon: 'code-slash',
  },
  {
    id: 'research',
    name: 'Research Agent',
    role: 'specialist',
    description: 'Searches approved sources and summarizes documents.',
    icon: 'search',
  },
  {
    id: 'operations',
    name: 'Operations Agent',
    role: 'specialist',
    description: 'Handles automation, background jobs, and device workflows.',
    icon: 'construct',
  },
  {
    id: 'browser',
    name: 'Browser Agent',
    role: 'specialist',
    description: 'Navigates websites and performs browser automation.',
    icon: 'globe',
  },
  {
    id: 'writer',
    name: 'Writing Agent',
    role: 'specialist',
    description: 'Drafts documents and prepares content for approval.',
    icon: 'create',
  },
];

export const BUILT_IN_AGENTS: AgentIdentity[] = [MASTER_AGENT, ...SPECIALIST_AGENTS];

const AGENT_ROW = 'id, user_id, name, role, description, icon';

type AgentRow = {
  id: string;
  user_id: number;
  name: string;
  role: AgentRole;
  description: string;
  icon: string | null;
};

export function getAgentIdentity(id: string): AgentIdentity | null {
  return BUILT_IN_AGENTS.find((agent) => agent.id === id) ?? null;
}

export async function listDynamicAgents(
  db: SQLiteDatabase,
  userId: number
): Promise<AgentIdentity[]> {
  try {
    const rows = (await db.getAllAsync(
      `SELECT ${AGENT_ROW} FROM permission_agents WHERE user_id = ? ORDER BY created_at ASC`,
      userId
    )) as AgentRow[];

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      description: row.description,
      icon: row.icon ?? 'sparkles',
    }));
  } catch {
    return [];
  }
}

export async function resolveAgentIdentity(
  db: SQLiteDatabase,
  userId: number,
  id: string
): Promise<AgentIdentity | null> {
  const builtIn = getAgentIdentity(id);

  if (builtIn) {
    return builtIn;
  }

  const dynamic = await listDynamicAgents(db, userId);
  return dynamic.find((agent) => agent.id === id) ?? null;
}

/**
 * Dynamic Agent Factory seam. A created agent gets a unique identity and starts
 * with zero permissions. It can never inherit a grant from the agent that
 * created it, because grants always match on the exact agent id.
 */
export async function createDynamicAgent(
  db: SQLiteDatabase,
  userId: number,
  input: { name: string; description?: string; role?: AgentRole }
): Promise<AgentIdentity> {
  const name = input.name.trim();

  if (!name) {
    throw new Error('An agent needs a name.');
  }

  const id = `agent_${Crypto.randomUUID()}`;
  const agent: AgentIdentity = {
    id,
    name,
    role: input.role ?? 'dynamic',
    description: input.description?.trim() || 'A dynamic agent created by Orbit.',
    icon: 'sparkles',
  };
  const now = Date.now();

  await db.runAsync(
    `INSERT INTO permission_agents (id, user_id, name, role, description, icon, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    agent.id,
    userId,
    agent.name,
    agent.role,
    agent.description,
    agent.icon,
    now,
    now
  );

  return agent;
}

/**
 * Subagents are specialist identities owned by the delegation runtime. They
 * receive their own id so a grant can never leak from Master Agent (or another
 * subagent) into this one.
 */
export function agentIdentityForSubagent(subagent: {
  id: string;
  name: string;
  description?: string;
}): AgentIdentity {
  return {
    id: `subagent_${subagent.id}`,
    name: subagent.name,
    role: 'dynamic',
    description: subagent.description || 'A delegated Orbit specialist.',
    icon: 'git-branch-outline',
  };
}

export type AgentGrantSummary = {
  agent: AgentIdentity;
  permissions: number;
  lastUsedAt: number | null;
};

export function summarizeAgents(
  grants: { agentId: string; agentName: string; lastUsedAt: number | null }[],
  dynamicAgents: AgentIdentity[]
): AgentGrantSummary[] {
  const agents = new Map<string, AgentIdentity>();

  for (const agent of [...BUILT_IN_AGENTS, ...dynamicAgents]) {
    agents.set(agent.id, agent);
  }

  for (const grant of grants) {
    if (!agents.has(grant.agentId)) {
      agents.set(grant.agentId, {
        id: grant.agentId,
        name: grant.agentName,
        role: 'dynamic',
        description: 'An agent recognized from a saved permission.',
        icon: 'sparkles',
      });
    }
  }

  return Array.from(agents.values())
    .map((agent) => {
      const matching = grants.filter((grant) => grant.agentId === agent.id);
      const lastUsedAt = matching.reduce<number | null>((latest, grant) => {
        if (grant.lastUsedAt === null) {
          return latest;
        }

        return latest === null ? grant.lastUsedAt : Math.max(latest, grant.lastUsedAt);
      }, null);

      return { agent, permissions: matching.length, lastUsedAt };
    })
    .sort((a, b) => b.permissions - a.permissions || a.agent.name.localeCompare(b.agent.name));
}
