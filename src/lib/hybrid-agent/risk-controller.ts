import type { PolicyEvaluation } from '../policy';
import { isProhibitedCapability, isSensitiveCapability } from './capability-catalog';
import { hashChain } from '../agent-runtime/hash';
import type {
  AutonomyDecision,
  CapabilityDescriptor,
  HybridIntent,
  HybridRiskDecision,
  HybridRiskLevel,
} from './types';

const RISK_RANK: Record<HybridRiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

function escalate(a: HybridRiskLevel, b: HybridRiskLevel): HybridRiskLevel {
  return RISK_RANK[a] >= RISK_RANK[b] ? a : b;
}

export function operationFingerprint(input: {
  toolName: string;
  args: Record<string, unknown>;
  stepId?: string;
  policyVersion?: string;
}): string {
  return hashChain({
    tool: input.toolName,
    args: input.args,
    stepId: input.stepId ?? null,
    policyVersion: input.policyVersion ?? null,
  });
}

/**
 * Deterministic autonomy decision. This module never asks an LLM and never
 * grants permission; it only chooses where a capability is allowed to go next.
 */
export function decideRisk(input: {
  intent: HybridIntent;
  toolName?: string;
  args?: Record<string, unknown>;
  policy: PolicyEvaluation;
  capability?: CapabilityDescriptor | null;
  policyVersion?: string;
}): HybridRiskDecision {
  const toolName = input.toolName ?? input.intent.calls[0]?.toolName ?? '';
  const args = input.args ?? input.intent.calls[0]?.args ?? {};
  const fingerprint = operationFingerprint({
    toolName,
    args,
    policyVersion: input.policyVersion,
  });

  if (input.intent.decision === 'PROHIBITED' || isProhibitedCapability(toolName)) {
    return {
      decision: 'PROHIBITED',
      risk: 'critical',
      reason: 'The operation is explicitly prohibited by the deterministic safety rules.',
      operationFingerprint: fingerprint,
      requiresFreshConfirmation: false,
    };
  }

  if (input.policy.decision === 'deny') {
    return {
      decision: 'PROHIBITED',
      risk: 'critical',
      reason: input.policy.reason || 'Policy denied this operation.',
      operationFingerprint: fingerprint,
      requiresFreshConfirmation: false,
    };
  }

  let risk: HybridRiskLevel = input.capability?.riskHint ?? 'low';
  if (isSensitiveCapability(toolName)) risk = escalate(risk, 'medium');
  if (input.intent.kind === 'prohibited') risk = escalate(risk, 'critical');

  const approvalRequired =
    input.policy.decision === 'ask' ||
    risk === 'high' ||
    risk === 'critical' ||
    input.capability?.sensitive === true;

  const decision: AutonomyDecision = approvalRequired
    ? 'APPROVAL_REQUIRED'
    : input.intent.decision === 'NEEDS_AI'
      ? 'NEEDS_AI'
      : 'SAFE_AUTO';

  return {
    decision,
    risk,
    reason: approvalRequired
      ? 'The operation is sensitive and requires exact human approval.'
      : decision === 'NEEDS_AI'
        ? 'The intent requires bounded AI reasoning; no privileged action is inferred.'
        : 'The operation is deterministic, low-risk and allowlisted.',
    operationFingerprint: fingerprint,
    requiresFreshConfirmation: risk === 'high' || risk === 'critical',
    sandboxConstraints: { ...input.policy.sandbox },
  };
}

export function highestRisk(decisions: HybridRiskDecision[]): HybridRiskLevel {
  return decisions.reduce<HybridRiskLevel>(
    (highest, decision) => escalate(highest, decision.risk),
    'low'
  );
}
