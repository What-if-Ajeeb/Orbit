import type { SQLiteDatabase } from 'expo-sqlite';

import type { AgentIdentity } from '../permissions/types';
import type { ToolExecutionEvent } from '../chat-store';
import type { ArtifactRef } from '../artifacts/types';
import type { LlmAttachment } from '../ai/types';

export type AgentTaskKind = 'turn' | 'tool' | 'workflow' | 'subagent' | 'scheduled';

export type AgentTaskStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'awaiting_tool'
  | 'blocked'
  | 'paused'
  | 'needs_review'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'unknown';

export type AgentTaskPhase = 'system' | 'ai' | 'verify' | 'done';

export type AgentBudget = {
  maxWallMs?: number;
  maxToolCalls?: number;
  maxTokensIn?: number;
  maxTokensOut?: number;
  maxRetries?: number;
  maxSubagentDepth?: number;
  maxCostUnits?: number;
};

export type VerificationStatus = 'verified' | 'unverified' | 'uncertain' | 'failed';

export type AgentTaskVerification = {
  verified: boolean;
  status: VerificationStatus;
  reason: string;
  evidence: Record<string, unknown>;
};

export type CapabilityGrant = {
  toolName: string;
  category?: string;
  resourceKey?: string;
  status?: 'active' | 'revoked';
  expiresAt?: number;
};

export type AgentTask = {
  id: string;
  userId: number;
  conversationId: number | null;
  projectId: string;
  parentTaskId: string | null;
  subagentId: string | null;
  kind: AgentTaskKind;
  title: string;
  status: AgentTaskStatus;
  phase: AgentTaskPhase;
  input: Record<string, unknown>;
  result: Record<string, unknown> | null;
  verification: AgentTaskVerification | null;
  error: string | null;
  attempts: number;
  maxAttempts: number;
  priority: number;
  idempotencyKey: string | null;
  leaseOwner: string | null;
  leaseUntil: number | null;
  budget: AgentBudget;
  grants: CapabilityGrant[];
  createdAt: number;
  updatedAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  nextRunAt: number | null;
};

export type AgentTaskEvent = {
  id: number;
  taskId: string;
  sequence: number;
  userId: number;
  type: string;
  payload: Record<string, unknown>;
  createdAt: number;
  previousHash: string;
  hash: string;
};

export type AgentTaskAttempt = {
  id: string;
  taskId: string;
  attempt: number;
  toolName: string;
  status: 'running' | 'success' | 'failed' | 'denied' | 'cancelled';
  startedAt: number;
  finishedAt: number | null;
  durationMs: number;
  errorCode: string | null;
  error: string | null;
  verification: AgentTaskVerification | null;
  metadata: Record<string, unknown>;
};

export type AgentTaskSchedule = {
  id: string;
  userId: number;
  ownerType: 'agent_task' | 'workflow';
  ownerId: string;
  taskId: string | null;
  title: string;
  input: Record<string, unknown>;
  enabled: boolean;
  intervalMs: number | null;
  nextRunAt: number;
  lastRunAt: number | null;
  leaseOwner: string | null;
  leaseUntil: number | null;
  idempotencyKey: string;
  createdAt: number;
  updatedAt: number;
};

export type RuntimeHistoryItem = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: LlmAttachment[];
};

export type RuntimeTurnInput = {
  db: SQLiteDatabase;
  userId: number;
  userName: string;
  history: RuntimeHistoryItem[];
  settings: import('../ai/settings').AiSettings;
  conversationId: number;
  agent?: AgentIdentity;
  projectId?: string;
  projectLabel?: string;
  creatorMode?: boolean;
  onTextDelta?: (delta: string) => void;
  onToolEvent?: (event: ToolExecutionEvent) => void;
  signal?: AbortSignal;
  /** Optional explicit grants for subagent or scheduled runs. */
  grants?: CapabilityGrant[];
  /** Budget caps for this turn. Defaults are applied by the orchestrator. */
  budget?: AgentBudget;
  /** Parent task id when this turn is a delegated subagent run. */
  parentTaskId?: string;
};

export type RuntimeTurnResult = {
  reply: string;
  traces: string[];
  artifacts: ArtifactRef[];
  toolEvents: ToolExecutionEvent[];
  mode: 'ai' | 'local' | 'system';
  taskId: string;
  status: AgentTaskStatus;
  verification: AgentTaskVerification;
};

export type RuntimeToolCall = {
  toolName: string;
  args: Record<string, unknown>;
  rawArguments: string;
  content: string;
  success: boolean;
  error?: string;
  errorCode?: string;
  durationMs: number;
  trace: string;
  policyDecision?: string;
  verification: AgentTaskVerification;
};

export type CapabilityPlanCall = {
  toolName: string;
  args: Record<string, unknown>;
};

export type CapabilityRouteResult =
  | {
      kind: 'handled';
      calls: CapabilityPlanCall[];
      reply: string;
      traces: string[];
    }
  | {
      kind: 'partial';
      calls: CapabilityPlanCall[];
      notes: string[];
    }
  | { kind: 'needs_ai'; notes: string[] }
  | { kind: 'denied'; reason: string; toolName?: string };

export type DelegatedRunInput = Omit<RuntimeTurnInput, 'history'> & {
  history?: RuntimeHistoryItem[];
  instruction: string;
  subagentId: string;
  grants: CapabilityGrant[];
  maxDepth?: number;
};
