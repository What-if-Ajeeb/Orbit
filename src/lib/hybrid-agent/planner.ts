import { hashChain } from '../agent-runtime/hash';

import { decideRisk, operationFingerprint } from './risk-controller';
import type {
  AutonomyDecision,
  CapabilityDescriptor,
  HybridCapabilityCall,
  HybridPlan,
  HybridPlanStep,
  HybridRejectedCall,
  HybridRiskDecision,
  HybridRiskLevel,
} from './types';
import type { PolicyEvaluation } from '../policy';

/**
 * Builds a bounded, explicit plan. The planner never invents tools: every step
 * must already exist in the capability catalog and pass deterministic policy.
 */
export function buildPlan(input: {
  goal: string;
  calls: HybridCapabilityCall[];
  notes?: string[];
  policy: PolicyEvaluation;
  evaluatePolicy?: (toolName: string, args: Record<string, unknown>) => PolicyEvaluation;
  policyVersion?: string;
  catalog: CapabilityDescriptor[];
  catalogNames?: Set<string>;
  createdAt?: number;
}): { plan: HybridPlan; decisions: HybridRiskDecision[] } {
  const createdAt = input.createdAt ?? Date.now();
  const allowedNames =
    input.catalogNames ?? new Set(input.catalog.map((entry) => entry.name));
  const steps: HybridPlanStep[] = [];
  const rejected: HybridRejectedCall[] = [];
  const decisions: HybridRiskDecision[] = [];

  for (const [index, call] of input.calls.entries()) {
    const capability =
      input.catalog.find((entry) => entry.name === call.toolName) ?? null;

    if (!capability || !allowedNames.has(call.toolName)) {
      const reason = `${call.toolName} is not in the active capability catalog.`;
      rejected.push({ toolName: call.toolName, reason });
      decisions.push({
        decision: 'PROHIBITED',
        risk: 'critical',
        reason,
        operationFingerprint: operationFingerprint({ toolName: call.toolName, args: call.args }),
        requiresFreshConfirmation: false,
      });
      continue;
    }

    const stepId = `step_${index + 1}_${hashChain({ tool: call.toolName, args: call.args }).slice(0, 10)}`;
    const policy = input.evaluatePolicy?.(call.toolName, call.args) ?? input.policy;
    const risk = decideRisk({
      intent: {
        kind: 'unknown',
        confidence: 1,
        calls: [call],
        notes: [],
        decision: 'SAFE_AUTO',
      },
      toolName: call.toolName,
      args: call.args,
      policy,
      capability,
      policyVersion: input.policyVersion,
    });

    steps.push({
      id: stepId,
      toolName: call.toolName,
      args: call.args,
      dependsOn: index > 0 ? [steps[index - 1].id] : [],
      decision: risk.decision as AutonomyDecision,
      risk: risk.risk as HybridRiskLevel,
      operationFingerprint: risk.operationFingerprint,
      notes: [risk.reason],
    });
    decisions.push(risk);
  }

  return {
    plan: {
      version: 1,
      goal: input.goal.slice(0, 4_000),
      steps,
      rejected,
      notes: input.notes ?? [],
      createdAt,
    },
    decisions,
  };
}

export function planRequiresApproval(plan: HybridPlan): boolean {
  return plan.steps.some((step) => step.decision === 'APPROVAL_REQUIRED');
}

export function planIsProhibited(plan: HybridPlan): boolean {
  return plan.steps.some((step) => step.decision === 'PROHIBITED') || plan.rejected.length > 0;
}
