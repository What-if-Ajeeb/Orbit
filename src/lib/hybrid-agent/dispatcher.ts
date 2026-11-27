import type { SQLiteDatabase } from 'expo-sqlite';

import { newToolEventId } from '../agent-settings';
import { agentToolRegistry, executeTool } from '../ai/tools';
import { toolFail } from '../ai/tool-registry';
import { newAgentTaskId } from '../agent-runtime/task-manager';
import type { AgentTaskVerification, CapabilityGrant, RuntimeToolCall } from '../agent-runtime/types';
import {
  unverified,
  verifyToolCall,
} from '../agent-runtime/verification';
import type { ToolExecutionEvent } from '../chat-store';
import { policyEngine, type PolicyDecision, type PolicyEvaluation } from '../policy';
import type { AgentIdentity } from '../permissions/types';
import { secureExecuteTool } from '../permissions/executor';
import { redactSecrets } from '../permissions/redact';
import { sandboxGate } from '../sandbox/adapters';
import { executeDeclarativeSkill } from '../skills/executor';
import { findSkillTool, type SkillManifest } from '../skills/manifest';
import { TelemetryStore } from '../telemetry';

import { recordHybridEvent } from './audit';
import { operationFingerprint } from './risk-controller';
import type { HybridCapabilityCall, HybridTraceContext } from './types';

type EventType =
  | 'tool_call'
  | 'tool_result';

export type DispatchContext = {
  db: SQLiteDatabase;
  userId: number;
  conversationId: number;
  agent: AgentIdentity;
  projectId: string;
  projectLabel: string;
  taskId: string;
  signal?: AbortSignal;
  grants?: CapabilityGrant[];
  manifests: SkillManifest[];
  allowedTool: (toolName: string) => boolean;
  onToolEvent?: (event: ToolExecutionEvent) => void;
  emit: (type: EventType, payload: Record<string, unknown>) => Promise<void>;
  telemetry: TelemetryStore;
  trace: HybridTraceContext;
  /** Pre-evaluated policy from the planner, so the fingerprint cannot drift. */
  policyEvaluation?: PolicyEvaluation & { policyVersion?: string };
  /** Sensitive plan steps always require a fresh, exact user decision. */
  forceApproval?: boolean;
};

export type DispatchResult = RuntimeToolCall & {
  toolEvents: ToolExecutionEvent[];
  policyRuleId: string | null;
  policyRuleName: string | null;
  permissionRequestId: string | null;
  permissionAllowed: boolean | null;
  stepId: string;
};

function toJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * The single dispatch surface for all capability kinds. Declarative skills and
 * builtin/plugin/MCP tools take different execution paths, but both terminate
 * at `secureExecuteTool()` so policy, approvals and sandbox checks cannot be
 * skipped.
 */
export async function dispatchCapabilityCall(
  call: HybridCapabilityCall,
  context: DispatchContext
): Promise<DispatchResult> {
  const startedAt = Date.now();
  const args = call.args ?? {};
  const rawArguments = JSON.stringify(args);
  const policyVersion = context.policyEvaluation?.policyVersion;
  const stepId = operationFingerprint({
    toolName: call.toolName,
    args,
    policyVersion,
  }).slice(0, 24);
  const toolEvents: ToolExecutionEvent[] = [];
  let permissionRequestId: string | null = null;
  let permissionAllowed: boolean | null = null;

  const running: ToolExecutionEvent = {
    id: newToolEventId(),
    toolName: call.toolName,
    status: 'running',
    startedAt,
    summary: `Running ${call.toolName}`,
  };
  toolEvents.push(running);
  context.onToolEvent?.(running);

  let content = toolFail(`${call.toolName} is not enabled for this agent.`);
  let success = false;
  let error = `${call.toolName} is not enabled for this agent.`;
  let errorCode: string | undefined;
  let durationMs = 0;
  let trace = '';
  let policyDecision: PolicyDecision = 'deny';
  let policyRuleId: string | null = null;
  let policyRuleName: string | null = null;

  if (!context.allowedTool(call.toolName)) {
    const denied: ToolExecutionEvent = {
      ...running,
      status: 'denied',
      endedAt: Date.now(),
      durationMs: 0,
      summary: `${call.toolName} was blocked.`,
      detail: error,
    };
    toolEvents[0] = denied;
    context.onToolEvent?.(denied);
    await context.emit('tool_call', {
      toolName: call.toolName,
      agentId: context.agent.id,
      rawArguments: redactSecrets(rawArguments).slice(0, 2_000),
      unauthorized: true,
      traceId: context.trace.traceId,
      stepId,
    });
    await context.emit('tool_result', {
      toolName: call.toolName,
      success: false,
      denied: true,
      traceId: context.trace.traceId,
      stepId,
    });
    await context.telemetry.recordToolCall(
      context.userId,
      context.conversationId,
      call.toolName,
      0,
      null,
      null,
      null,
      false,
      'deny',
      error
    );
    await recordHybridEvent(context.db, {
      traceId: context.trace.traceId,
      taskId: context.taskId,
      userId: context.userId,
      source: 'dispatcher',
      type: 'capability.denied',
      payload: { toolName: call.toolName, stepId, reason: error },
    });
  } else {
    const policy: PolicyEvaluation & { policyVersion?: string } =
      context.policyEvaluation ??
      policyEngine.evaluatePolicyForExecution(call.toolName, args);
    policyDecision = context.forceApproval ? 'ask' : policy.decision;
    policyRuleId = policy.ruleId;
    policyRuleName = policy.ruleName;
    running.policyDecision = policyDecision;
    toolEvents[0] = running;
    context.onToolEvent?.(running);
    await context.emit('tool_call', {
      toolName: call.toolName,
      agentId: context.agent.id,
      agentName: context.agent.name,
      rawArguments: redactSecrets(rawArguments).slice(0, 2_000),
      traceId: context.trace.traceId,
      stepId,
    });

    const skillTool = findSkillTool(call.toolName, context.manifests);
    if (skillTool && context.forceApproval) {
      // A skill is a data-only workflow; sensitive work must be approved at the
      // direct capability boundary instead of being inferred from skill steps.
      error = `${call.toolName} requires a direct, exact approval and cannot run as a skill.`;
      success = false;
      content = toolFail(error);
      await recordHybridEvent(context.db, {
        traceId: context.trace.traceId,
        taskId: context.taskId,
        userId: context.userId,
        source: 'dispatcher',
        type: 'capability.approval_required',
        payload: { toolName: call.toolName, stepId, reason: error },
      });
    } else if (skillTool) {
      const execution = await executeDeclarativeSkill(
        {
          db: context.db,
          userId: context.userId,
          conversationId: context.conversationId,
          agent: context.agent,
          projectId: context.projectId,
          projectLabel: context.projectLabel,
          signal: context.signal,
          grants: context.grants,
          isToolAllowed: context.allowedTool,
          sandboxGate,
        },
        skillTool.manifest.id,
        skillTool.capability.name,
        args
      );
      durationMs = execution.durationMs;
      success = execution.success;
      error = execution.error ?? '';
      trace = `Skill ${skillTool.manifest.name} → ${skillTool.capability.name}`;
      content = JSON.stringify({
        ok: execution.success,
        ...execution.output,
        ...(execution.error ? { error: execution.error } : {}),
      });
    } else {
      const secured = await secureExecuteTool({
        db: context.db,
        userId: context.userId,
        agent: context.agent,
        conversationId: context.conversationId,
        projectId: context.projectId,
        projectLabel: context.projectLabel,
        toolName: call.toolName,
        rawArguments,
        policy: {
          decision: policyDecision,
          ruleId: policy.ruleId,
          reason: policy.reason,
          ...(policy.sandbox ? { sandbox: policy.sandbox } : {}),
          ...(policyVersion ? { policyVersion } : {}),
        },
        timeoutMs: agentToolRegistry.get(call.toolName)?.timeoutMs,
        signal: context.signal,
        sandboxGate,
        execute: (signal) =>
          executeTool(
            context.db,
            context.userId,
            call.toolName,
            rawArguments,
            context.conversationId,
            signal,
            context.agent
          ),
      });
      content = secured.content;
      trace = secured.trace;
      success = secured.success;
      error = secured.error ?? '';
      errorCode = secured.errorCode;
      durationMs = secured.durationMs;
      permissionRequestId = secured.permission?.requestId ?? null;
      permissionAllowed = secured.permission?.allowed ?? null;
    }

    const finished: ToolExecutionEvent = {
      ...running,
      status: success ? 'success' : 'error',
      endedAt: Date.now(),
      durationMs,
      summary: success ? `${call.toolName} completed.` : `${call.toolName} failed.`,
      ...(error || trace ? { detail: redactSecrets(error || trace).slice(0, 800) } : {}),
    };
    toolEvents[toolEvents.length - 1] = finished;
    context.onToolEvent?.(finished);
    await context.telemetry.recordToolCall(
      context.userId,
      context.conversationId,
      call.toolName,
      durationMs,
      null,
      null,
      null,
      success,
      policyDecision,
      errorCode ? `${errorCode}: ${error ?? ''}` : error
    );
    await context.emit('tool_result', {
      toolName: call.toolName,
      durationMs,
      success,
      error,
      errorCode,
      resultLength: content.length,
      policy: policyDecision,
      rule: policyRuleName,
      traceId: context.trace.traceId,
      stepId,
    });
  }

  const runtimeCall: RuntimeToolCall = {
    toolName: call.toolName,
    args: toJsonObject(rawArguments),
    rawArguments,
    content,
    success,
    error,
    errorCode,
    durationMs,
    trace,
    policyDecision,
    verification: unverified('Pending verification.'),
  };
  runtimeCall.verification = verifyToolCall(runtimeCall);

  await recordHybridEvent(context.db, {
    traceId: context.trace.traceId,
    taskId: context.taskId,
    userId: context.userId,
    source: 'dispatcher',
    type: success ? 'capability.success' : 'capability.failure',
    payload: {
      toolName: call.toolName,
      stepId,
      policy: policyDecision,
      policyVersion: policyVersion ?? null,
      forceApproval: context.forceApproval === true,
      permissionRequestId,
      permissionAllowed,
      errorCode: errorCode ?? null,
      verified: runtimeCall.verification.verified,
    },
  });

  return {
    ...runtimeCall,
    toolEvents,
    policyRuleId,
    policyRuleName,
    permissionRequestId,
    permissionAllowed,
    stepId,
  };
}

export function dispatchVerification(
  result: DispatchResult
): AgentTaskVerification {
  return result.verification;
}

export function newDispatchStepId(): string {
  return newAgentTaskId('step');
}
