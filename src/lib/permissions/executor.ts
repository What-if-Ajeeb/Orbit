import type { SQLiteDatabase } from 'expo-sqlite';

import { toolFail, type ToolExecution } from '../ai/tool-registry';
import type { PolicyDecision } from '../policy';
import type {
  AgentIdentity,
  ClassifiedPermissionAction,
  PairedDeviceRecord,
  PermissionCategory,
  PermissionDenialReason,
  RiskLevel,
} from './types';
import { ensureAndroidRuntimePermission } from './android';
import { classifyToolAction } from './classifier';
import { blockedCommandReason, validatePath } from './command-policy';
import { listPairedDevices } from './devices';
import {
  executionLimitFor,
  ToolLimitError,
  withToolLimit,
  type ToolFailureCode,
} from './execution-limit';
import {
  formatPipeline,
  ToolExecutionPipeline,
  type ToolPipelineSnapshot,
} from './execution-pipeline';
import { permissionManager } from './manager';
import { truncate } from './redact';

type JsonObject = Record<string, unknown>;

export type { ToolFailureCode } from './execution-limit';

export type SecureToolExecution = {
  success: boolean;
  content: string;
  trace: string;
  durationMs: number;
  error?: string;
  /** Structured machine-readable failure, when the limit stopped the call. */
  errorCode?: ToolFailureCode;
  /** Ordered, one-way record of the guards that ran for this call. */
  pipeline: ToolPipelineSnapshot;
  permission: {
    requestId: string | null;
    allowed: boolean;
    via?: string;
    reason?: PermissionDenialReason;
    risk: RiskLevel;
    category: PermissionCategory;
  };
};

type SecureToolInput = {
  db: SQLiteDatabase;
  userId: number;
  agent: AgentIdentity;
  conversationId?: number | null;
  projectId: string;
  projectLabel: string;
  toolName: string;
  rawArguments: string;
  policy: {
    decision: PolicyDecision;
    ruleId: string | null;
    reason?: string;
  };
  /** Tool-declared cooperative limit; the classifier default is used if absent. */
  timeoutMs?: number;
  /** User stop / navigation signal. Aborting denies the in-flight call. */
  signal?: AbortSignal;
  execute: (signal: AbortSignal) => Promise<ToolExecution>;
};

function parseArguments(rawArguments: string): JsonObject | null {
  try {
    const parsed = JSON.parse(rawArguments || '{}') as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : null;
  } catch {
    return null;
  }
}

function commandFrom(args: JsonObject): string {
  const value = args.command ?? args.cmd ?? args.script ?? args.shell;
  return typeof value === 'string' ? value.trim() : '';
}

function pathFrom(args: JsonObject): string {
  const value = args.cwd ?? args.path ?? args.file_path ?? args.directory ?? args.dir;
  return typeof value === 'string' ? value.trim() : '';
}

function deniedResult(
  input: SecureToolInput,
  reason: PermissionDenialReason,
  message: string,
  requestId: string | null,
  pipeline: ToolExecutionPipeline,
  action?: ClassifiedPermissionAction
): SecureToolExecution {
  pipeline.deny(reason, message);
  pipeline.finish();

  return {
    success: false,
    content: toolFail(message),
    trace: `DENIED ${input.toolName}`,
    durationMs: 0,
    error: message,
    pipeline: pipeline.snapshot(),
    permission: {
      requestId,
      allowed: false,
      reason,
      risk: action?.risk ?? 'medium',
      category: action?.category ?? 'background_automation',
    },
  };
}

/**
 * The single execution boundary for every agent tool call. Nothing protected
 * runs unless the Permission Manager issued a fresh, scoped authorization and
 * that authorization is revalidated immediately before execution.
 *
 * Stages are monotonic: classify → authorize → pre-execute checks → guard →
 * execute → post-execute → finalize. A denial is never reversible and a
 * consumed one-time grant can never authorize a second execution.
 */
export async function secureExecuteTool(input: SecureToolInput): Promise<SecureToolExecution> {
  permissionManager.attach(input.db);

  const pipeline = new ToolExecutionPipeline(input.toolName);
  const args = parseArguments(input.rawArguments);

  if (!args) {
    return deniedResult(
      input,
      'invalid_request',
      'Arguments must be a JSON object. Nothing was executed.',
      null,
      pipeline
    );
  }

  let devices: PairedDeviceRecord[] = [];

  try {
    devices = (await listPairedDevices(input.db, input.userId)).filter(
      (device) => device.status === 'paired'
    );
  } catch {
    devices = [];
  }

  const action = classifyToolAction({
    toolName: input.toolName,
    args,
    agent: input.agent,
    projectId: input.projectId,
    projectLabel: input.projectLabel,
    devices,
  });
  pipeline.enter('classify', `category=${action.category} risk=${action.risk}`);

  if (action.category === 'computer_access' && devices.length === 0) {
    const message =
      'No paired ORBIT Desktop Companion is available. Pair a computer in Settings → Agent Permissions first.';
    await permissionManager.recordAudit({
      userId: input.userId,
      agentId: input.agent.id,
      event: 'execution_blocked',
      category: action.category,
      risk: action.risk,
      toolName: input.toolName,
      projectId: input.projectId,
      detail: message,
    });

    return deniedResult(input, 'invalid_request', message, null, pipeline, action);
  }

  const outcome = await permissionManager.requestToolPermission({
    userId: input.userId,
    conversationId: input.conversationId ?? null,
    action,
    policy: input.policy,
  });

  if (!outcome.allowed) {
    return deniedResult(
      input,
      outcome.reason,
      outcome.message,
      outcome.request?.id ?? null,
      pipeline,
      action
    );
  }

  pipeline.enter('authorize', outcome.via);
  const authorization = outcome.authorization;
  pipeline.enter('pre_execute');

  if (
    action.category === 'camera_microphone' ||
    action.category === 'location' ||
    action.category === 'contacts'
  ) {
    const android = await ensureAndroidRuntimePermission(action.category);

    if (android.state === 'denied' || android.state === 'unavailable') {
      await permissionManager.blockExecution(
        authorization,
        'android_permission_denied',
        android.message
      );
      return deniedResult(
        input,
        'android_permission_denied',
        android.message,
        outcome.request.id,
        pipeline,
        action
      );
    }
  }

  const command = commandFrom(args);
  const path = pathFrom(args);

  if (command && (action.category === 'computer_access' || action.category === 'terminal_commands')) {
    const blocked = blockedCommandReason(command);

    if (blocked) {
      await permissionManager.blockExecution(authorization, 'command_blocked', blocked);
      return deniedResult(input, 'command_blocked', blocked, outcome.request.id, pipeline, action);
    }
  }

  if (path && (action.category === 'computer_access' || action.category.startsWith('file_'))) {
    const pathError = validatePath(path);

    if (pathError) {
      await permissionManager.blockExecution(authorization, 'command_blocked', pathError);
      return deniedResult(
        input,
        'command_blocked',
        pathError,
        outcome.request.id,
        pipeline,
        action
      );
    }
  }

  // Revalidate the authorization immediately before handing control to the
  // tool. This consumes one-time grants and checks emergency stop again.
  pipeline.enter('guard');
  const validation = await permissionManager.beginExecution(authorization, {
    agentId: input.agent.id,
    toolName: input.toolName,
    category: action.category,
  });

  if (!validation.ok) {
    return deniedResult(
      input,
      validation.reason,
      validation.message,
      outcome.request.id,
      pipeline,
      action
    );
  }

  pipeline.markExecuted();
  const start = Date.now();
  const timeoutMs = executionLimitFor(input.timeoutMs, action);

  try {
    const execution = await withToolLimit(
      (toolSignal) => input.execute(toolSignal),
      { timeoutMs, signal: input.signal }
    );
    const durationMs = Date.now() - start;
    pipeline.enter('post_execute');
    await permissionManager.finishExecution(
      authorization,
      true,
      undefined,
      formatPipeline(pipeline.snapshot())
    );
    pipeline.finish();

    return {
      success: true,
      content: execution.content,
      trace: execution.trace,
      durationMs,
      pipeline: pipeline.snapshot(),
      permission: {
        requestId: outcome.request.id,
        allowed: true,
        via: outcome.via,
        risk: action.risk,
        category: action.category,
      },
    };
  } catch (error) {
    const durationMs = Date.now() - start;
    const limited = error instanceof ToolLimitError ? error : null;
    const message = limited
      ? limited.message
      : error instanceof Error && error.message
        ? error.message
        : 'Tool execution failed.';
    const reason: PermissionDenialReason | undefined = limited
      ? limited.code === 'TOOL_TIMEOUT'
        ? 'execution_timeout'
        : 'user_cancelled'
      : undefined;
    const trace = limited
      ? `${limited.code === 'TOOL_TIMEOUT' ? 'TIMEOUT' : 'CANCELLED'} ${input.toolName}`
      : `FAILED ${input.toolName}`;

    pipeline.enter('post_execute', limited?.code ?? 'error');
    pipeline.finish();
    await permissionManager.finishExecution(
      authorization,
      false,
      truncate(message, 300),
      formatPipeline(pipeline.snapshot())
    );

    return {
      success: false,
      content: toolFail(message),
      trace,
      durationMs,
      error: message,
      ...(limited ? { errorCode: limited.code } : {}),
      pipeline: pipeline.snapshot(),
      permission: {
        requestId: outcome.request.id,
        // The permission itself was granted; a limit stopped the tool body.
        allowed: !limited,
        ...(reason ? { reason } : {}),
        risk: action.risk,
        category: action.category,
      },
    };
  }
}

export function secureDeniedResult(
  toolName: string,
  message: string,
  category: PermissionCategory = 'background_automation',
  risk: RiskLevel = 'medium'
): SecureToolExecution {
  const pipeline = new ToolExecutionPipeline(toolName);
  pipeline.deny('policy_denied', message);
  pipeline.finish();

  return {
    success: false,
    content: toolFail(message),
    trace: `DENIED ${toolName}`,
    durationMs: 0,
    error: message,
    pipeline: pipeline.snapshot(),
    permission: {
      requestId: null,
      allowed: false,
      reason: 'policy_denied',
      risk,
      category,
    },
  };
}
