import type {
  AgentIdentity,
  PermissionCategory,
  RiskLevel,
} from '@/lib/permissions/types';

export const AGENT_ACTION_STATUSES = [
  'draft',
  'awaiting_approval',
  'approved',
  'executing',
  'completed',
  'rejected',
  'cancelled',
  'failed',
] as const;

export type AgentActionStatus = (typeof AGENT_ACTION_STATUSES)[number];

export type AgentActionDisplay = {
  title: string;
  target: string;
  lines: string[];
};

/**
 * A typed integration declares its own validation, exact tool arguments and
 * approval requirement. Integrations never receive execution privileges: every
 * action still passes through the shared permission executor.
 */
export type AgentActionIntegration<T = Record<string, unknown>> = {
  kind: string;
  label: string;
  toolName: string | ((payload: T) => string);
  requiredPermissions: readonly string[];
  approval: 'always' | 'never';
  validate: (payload: T) => string | null;
  describe: (payload: T) => AgentActionDisplay;
  buildArgs: (payload: T) => Record<string, unknown>;
};

export type AgentActionRecord = {
  id: string;
  userId: number;
  conversationId: number | null;
  agentId: string;
  agentName: string;
  kind: string;
  toolName: string;
  status: AgentActionStatus;
  title: string;
  target: string;
  lines: string[];
  payload: Record<string, unknown>;
  toolArgs: Record<string, unknown>;
  fingerprint: string;
  permissionRequestId: string | null;
  risk: RiskLevel;
  category: PermissionCategory;
  approvalFingerprint: string | null;
  approvedAt: number | null;
  result: string | null;
  error: string | null;
  trace: string | null;
  createdAt: number;
  updatedAt: number;
};

export type CreateAgentActionInput = {
  id: string;
  userId: number;
  conversationId?: number | null;
  agent: AgentIdentity;
  kind: string;
  payload: Record<string, unknown>;
};
