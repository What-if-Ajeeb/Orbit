import type { SQLiteDatabase } from 'expo-sqlite';

import { toolFail, type ToolExecution } from '../ai/tool-registry';
import type { PolicyDecision } from '../policy';
import type {
  AgentIdentity,
  ClassifiedPermissionAction,
  PairedDeviceRecord,
  PermissionAuthorization,
  PermissionCategory,
  PermissionDenialReason,
  PermissionRequestRecord,
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
import { redactSecrets, truncate } from './redact';

type JsonObject = Record<string, unknown>;

export type { ToolFailureCode } from './execution-limit';

export type SecureToolSandboxGateInput = {
  toolName: string;
  args: JsonObject;
  agent: AgentIdentity;
  projectId: string;
  projectLabel: string;
  signal?: AbortSignal;
};

export type SecureToolSandboxGate = (input: SecureToolSandboxGateInput) => Promise<void>;

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
  /**
   * Mandatory host-side sandbox mediation for sensitive operations. The loop
   * installs this for every tool call; sandboxed tools may still do their own
   * native mediation and are skipped by the adapter.
   */
  sandboxGate?: SecureToolSandboxGate;
  /**
   * Pre-issued authorization from an explicit Agent Action Card confirmation.
   * All guards below still run, including immediate revalidation. Callers can
   * only obtain this token by resolving a real permission request.
   */
  authorization?: PermissionAuthorization;
  authorizationRequest?: PermissionRequestRecord;
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

/** Aborts one execution when either the chat stop or emergency stop fires. */
function combineSignals(sources: (AbortSignal | undefined)[]): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const listeners: { source: AbortSignal; listener: () => void }[] = [];

  for (const source of sources) {
    if (!source) {
      continue;
    }

    if (source.aborted) {
      controller.abort();
      break;
    }

    const listener = () => controller.abort();
    source.addEventListener('abort', listener, { once: true });
    listeners.push({ source, listener });
  }

  return {
    signal: controller.signal,
    dispose: () => {
      for (const { source, listener } of listeners) {
        source.removeEventListener('abort', listener);
      }
    },
  };
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
    await permissionManager.recordActivity({
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      agentId: input.agent.id,
      agentName: input.agent.name,
      toolName: input.toolName,
      action: `Validate ${input.toolName} arguments`,
      status: 'denied',
      error: 'Arguments must be a JSON object. Nothing was executed.',
    });
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

  const activityBase = {
    userId: input.userId,
    conversationId: input.conversationId ?? null,
    agentId: input.agent.id,
    agentName: input.agent.name,
    toolName: input.toolName,
    action: action.title,
    resourceKey: action.resourceKey,
    resourceLabel: action.target.label,
    permissionUsed: action.category,
    category: action.category,
    risk: action.risk,
    reversible: action.reversible,
    external: action.external,
    metadata: {
      tool: action.toolName,
      target: action.target.label,
      targetDetail: action.target.detail ?? '',
      scope: action.scopeKey,
      resource: action.resourceKey,
      fingerprint: action.fingerprint,
      command: action.commandPreview ?? '',
      consequences: action.consequences.join(' | '),
      freshConfirmation: action.freshConfirmation,
    },
  };

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
    await permissionManager.recordActivity({
      ...activityBase,
      status: 'blocked',
      error: message,
    });

    return deniedResult(input, 'invalid_request', message, null, pipeline, action);
  }

  const outcome =
    input.authorization && input.authorizationRequest
      ? ({
          allowed: true,
          authorization: input.authorization,
          request: input.authorizationRequest,
          via: 'allow_once',
        } as const)
      : await permissionManager.requestToolPermission({
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
  const operation = permissionManager.startOperation({
    userId: input.userId,
    conversationId: input.conversationId ?? null,
    agentId: input.agent.id,
    agentName: input.agent.name,
    toolName: input.toolName,
    detail: action.title,
    cancellable: action.cancellable,
    external: action.external,
  });
  const signals = combineSignals([input.signal, operation.signal]);
  const finishOperation = async (
    status: 'completed' | 'failed' | 'stopped' | 'unknown',
    detail: string
  ): Promise<void> => {
    signals.dispose();
    await permissionManager.finishOperation(input.userId, operation.id, status, detail);
  };

  await permissionManager.recordActivity({
    ...activityBase,
    status: 'running',
    result: 'Authorized. The operation is starting.',
    requestId: outcome.request.id,
    grantId: authorization.grantId,
    metadata: {
      ...activityBase.metadata,
      authorizationVia: outcome.via,
      operationId: operation.id,
    },
  });

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
      await finishOperation('failed', android.message);
      await permissionManager.recordActivity({
        ...activityBase,
        status: 'blocked',
        error: android.message,
        requestId: outcome.request.id,
        grantId: authorization.grantId,
      });
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
      await finishOperation('failed', blocked);
      await permissionManager.recordActivity({
        ...activityBase,
        status: 'blocked',
        error: blocked,
        requestId: outcome.request.id,
        grantId: authorization.grantId,
      });
      return deniedResult(input, 'command_blocked', blocked, outcome.request.id, pipeline, action);
    }
  }

  if (path && (action.category === 'computer_access' || action.category.startsWith('file_'))) {
    const pathError = validatePath(path);

    if (pathError) {
      await permissionManager.blockExecution(authorization, 'command_blocked', pathError);
      await finishOperation('failed', pathError);
      await permissionManager.recordActivity({
        ...activityBase,
        status: 'blocked',
        error: pathError,
        requestId: outcome.request.id,
        grantId: authorization.grantId,
      });
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

  if (input.sandboxGate) {
    try {
      await input.sandboxGate({
        toolName: input.toolName,
        args,
        agent: input.agent,
        projectId: input.projectId,
        projectLabel: input.projectLabel,
        signal: signals.signal,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.message
          ? error.message
          : 'The Android sandbox denied this operation.';
      await permissionManager.blockExecution(authorization, 'sandbox_denied', message);
      await finishOperation('failed', message);
      await permissionManager.recordActivity({
        ...activityBase,
        status: 'blocked',
        error: truncate(redactSecrets(message), 800),
        requestId: outcome.request.id,
        grantId: authorization.grantId,
      });
      return deniedResult(
        input,
        'sandbox_denied',
        message,
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
    scopeKey: action.scopeKey,
    resourceKey: action.resourceKey,
    fingerprint: action.fingerprint,
    freshConfirmation: action.freshConfirmation,
    external: action.external,
    reversible: action.reversible,
  });

  if (!validation.ok) {
    await finishOperation('failed', validation.message);
    await permissionManager.recordActivity({
      ...activityBase,
      status: 'blocked',
      error: validation.message,
      requestId: outcome.request.id,
      grantId: authorization.grantId,
    });
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
      { timeoutMs, signal: signals.signal }
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
    await finishOperation('completed', execution.trace || `Completed ${action.title}.`);
    await permissionManager.recordActivity({
      ...activityBase,
      status: 'success',
      result: truncate(redactSecrets(execution.content || execution.trace || 'Completed.'), 800),
      requestId: outcome.request.id,
      grantId: authorization.grantId,
      metadata: {
        ...activityBase.metadata,
        trace: truncate(redactSecrets(execution.trace), 300),
        durationMs,
      },
    });

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
    const aborted = signals.signal.aborted;
    const uncertain = action.external && (aborted || limited?.code === 'TOOL_TIMEOUT');
    const visibleMessage = uncertain
      ? 'Stop requested, but this external action may have completed. Check the external service before retrying.'
      : message;
    const reason: PermissionDenialReason | undefined = limited
      ? limited.code === 'TOOL_TIMEOUT'
        ? 'execution_timeout'
        : 'user_cancelled'
      : aborted
        ? 'user_cancelled'
        : undefined;
    const trace = uncertain
      ? `UNCERTAIN ${input.toolName}`
      : limited
        ? `${limited.code === 'TOOL_TIMEOUT' ? 'TIMEOUT' : 'CANCELLED'} ${input.toolName}`
        : `FAILED ${input.toolName}`;

    pipeline.enter('post_execute', limited?.code ?? 'error');
    pipeline.finish();
    await permissionManager.finishExecution(
      authorization,
      false,
      truncate(visibleMessage, 300),
      formatPipeline(pipeline.snapshot())
    );
    await finishOperation(
      uncertain ? 'unknown' : aborted ? 'stopped' : 'failed',
      visibleMessage
    );
    await permissionManager.recordActivity({
      ...activityBase,
      status: uncertain ? 'unknown' : aborted ? 'stopped' : 'failed',
      error: truncate(redactSecrets(visibleMessage), 800),
      requestId: outcome.request.id,
      grantId: authorization.grantId,
      metadata: {
        ...activityBase.metadata,
        durationMs,
        limitCode: limited?.code ?? null,
      },
    });

    return {
      success: false,
      content: toolFail(visibleMessage),
      trace,
      durationMs,
      error: visibleMessage,
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
