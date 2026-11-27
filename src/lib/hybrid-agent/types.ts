/**
 * Canonical types for the ORBIT Hybrid Autonomous Agent.
 *
 * These types are data-only. They describe deterministic routing, planning,
 * approval binding and audit state; they never grant permission or execute
 * code. Every privileged capability still runs through `secureExecuteTool()`.
 */

export const HYBRID_TASK_STATES = [
  'QUEUED',
  'PLANNING',
  'RUNNING',
  'WAITING_FOR_APPROVAL',
  'VERIFYING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'BLOCKED',
] as const;

export type HybridTaskState = (typeof HYBRID_TASK_STATES)[number];

export type AutonomyDecision =
  | 'SAFE_AUTO'
  | 'NEEDS_AI'
  | 'APPROVAL_REQUIRED'
  | 'PROHIBITED';

export type HybridRiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type HybridTraceContext = {
  traceId: string;
  taskId?: string;
  parentTaskId?: string;
  stepId?: string;
};

export type HybridCapabilityCall = {
  toolName: string;
  args: Record<string, unknown>;
};

export type HybridPlanStep = {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  dependsOn: string[];
  decision: AutonomyDecision;
  risk: HybridRiskLevel;
  operationFingerprint: string;
  notes?: string[];
};

export type HybridRejectedCall = {
  toolName: string;
  reason: string;
};

export type HybridPlan = {
  version: 1;
  goal: string;
  steps: HybridPlanStep[];
  /** Capabilities dropped before planning; retained so denial is auditable. */
  rejected: HybridRejectedCall[];
  notes: string[];
  createdAt: number;
};

export type HybridRiskDecision = {
  decision: AutonomyDecision;
  risk: HybridRiskLevel;
  reason: string;
  operationFingerprint: string;
  requiresFreshConfirmation: boolean;
  sandboxConstraints?: Record<string, unknown>;
};

export type ApprovalBinding = {
  taskId: string;
  stepId: string;
  toolName: string;
  operationFingerprint: string;
  scopeKey: string;
  resourceKey: string;
  policyVersion: string;
  requestedAt: number;
};

export type ApprovalState = 'pending' | 'approved' | 'denied' | 'expired' | 'invalidated';

export type HybridAuditEvent = {
  id?: number;
  traceId: string;
  taskId: string | null;
  userId: number | null;
  source: string;
  type: string;
  payload: Record<string, unknown>;
  previousHash: string;
  hash: string;
  createdAt: number;
};

export type CapabilityDescriptor = {
  name: string;
  kind: 'builtin' | 'plugin' | 'mcp' | 'skill' | 'subagent';
  description?: string;
  riskHint?: HybridRiskLevel;
  sensitive?: boolean;
};

export type HybridIntentKind =
  | 'task.create'
  | 'task.list'
  | 'task.complete'
  | 'memory.remember'
  | 'memory.recall'
  | 'memory.forget'
  | 'web.search'
  | 'conversation'
  | 'prohibited'
  | 'unknown';

export type HybridIntent = {
  kind: HybridIntentKind;
  confidence: number;
  calls: HybridCapabilityCall[];
  notes: string[];
  decision: AutonomyDecision;
};
