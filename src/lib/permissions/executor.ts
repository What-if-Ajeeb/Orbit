import type { SQLiteDatabase } from 'expo-sqlite';

import { toolFail, type ToolExecution } from '../ai/tool-registry';
import type { PolicyDecision } from '../policy';
import type {
  AgentIdentity,
  PairedDeviceRecord,
  PermissionCategory,
  PermissionDenialReason,
  RiskLevel,
} from './types';
import { ensureAndroidRuntimePermission } from './android';
import { classifyToolAction } from './classifier';
import { blockedCommandReason, validatePath } from './command-policy';
import { listPairedDevices } from './devices';
import { permissionManager } from './manager';
import { truncate } from './redact';

type JsonObject = Record<string, unknown>;

export type SecureToolExecution = {
  success: boolean;
  content: string;
  trace: string;
  durationMs: number;
  error?: string;
  permission: {
    requestId: string | null;
    allowed: boolean;
    via?: string;
    reason?: string;
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
  execute: () => Promise<ToolExecution>;
};

class ExecutionTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Execution timed out after ${Math.round(timeoutMs / 1000)}s.`);
    this.name = 'ExecutionTimeoutError';
  }
}

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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ExecutionTimeoutError(timeoutMs)), timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function executionTimeoutFor(category: PermissionCategory): number {
  if (category === 'computer_access' || category === 'terminal_commands') {
    return 60_000;
  }

  if (category === 'background_automation' || category === 'browser_automation') {
    return 45_000;
  }

  return 20_000;
}

function commandFrom(args: JsonObject): string {
  const value = args.command ?? args.cmd ?? args.script ?? args.shell;
  return typeof value === 'string' ? value.trim() : '';
}

function pathFrom(args: JsonObject): string {
  const value = args.cwd ?? args.path ?? args.file_path ?? args.directory ?? args.dir;
  return typeof value === 'string' ? value.trim() : '';
}

function deniedResult(input: SecureToolInput, reason: PermissionDenialReason, message: string, requestId: string | null): SecureToolExecution {
  return {
    success: false,
    content: toolFail(message),
    trace: `DENIED ${input.toolName}`,
    durationMs: 0,
    error: message,
    permission: {
      requestId,
      allowed: false,
      reason,
      risk: 'medium',
      category: 'background_automation',
    },
  };
}

/**
 * The single execution boundary for every agent tool call. Nothing protected
 * runs unless the Permission Manager issued a fresh, scoped authorization and
 * that authorization is revalidated immediately before execution.
 */
export async function secureExecuteTool(input: SecureToolInput): Promise<SecureToolExecution> {
  permissionManager.attach(input.db);

  const args = parseArguments(input.rawArguments);

  if (!args) {
    return deniedResult(
      input,
      'invalid_request',
      'Arguments must be a JSON object. Nothing was executed.',
      null
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

    return {
      success: false,
      content: toolFail(message),
      trace: `BLOCKED ${input.toolName} · no paired computer`,
      durationMs: 0,
      error: message,
      permission: {
        requestId: null,
        allowed: false,
        reason: 'invalid_request',
        risk: action.risk,
        category: action.category,
      },
    };
  }

  const outcome = await permissionManager.requestToolPermission({
    userId: input.userId,
    conversationId: input.conversationId ?? null,
    action,
    policy: input.policy,
  });

  if (!outcome.allowed) {
    return {
      success: false,
      content: toolFail(outcome.message),
      trace: `DENIED ${input.toolName}`,
      durationMs: 0,
      error: outcome.message,
      permission: {
        requestId: outcome.request?.id ?? null,
        allowed: false,
        reason: outcome.reason,
        risk: action.risk,
        category: action.category,
      },
    };
  }

  const authorization = outcome.authorization;

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
      return {
        success: false,
        content: toolFail(android.message),
        trace: `BLOCKED ${input.toolName} · Android permission`,
        durationMs: 0,
        error: android.message,
        permission: {
          requestId: outcome.request.id,
          allowed: false,
          reason: 'android_permission_denied',
          risk: action.risk,
          category: action.category,
        },
      };
    }
  }

  const command = commandFrom(args);
  const path = pathFrom(args);

  if (command && (action.category === 'computer_access' || action.category === 'terminal_commands')) {
    const blocked = blockedCommandReason(command);

    if (blocked) {
      await permissionManager.blockExecution(authorization, 'command_blocked', blocked);
      return {
        success: false,
        content: toolFail(blocked),
        trace: `BLOCKED ${input.toolName} · unsafe command`,
        durationMs: 0,
        error: blocked,
        permission: {
          requestId: outcome.request.id,
          allowed: false,
          reason: 'command_blocked',
          risk: action.risk,
          category: action.category,
        },
      };
    }
  }

  if (path && (action.category === 'computer_access' || action.category.startsWith('file_'))) {
    const pathError = validatePath(path);

    if (pathError) {
      await permissionManager.blockExecution(authorization, 'command_blocked', pathError);
      return {
        success: false,
        content: toolFail(pathError),
        trace: `BLOCKED ${input.toolName} · path restriction`,
        durationMs: 0,
        error: pathError,
        permission: {
          requestId: outcome.request.id,
          allowed: false,
          reason: 'command_blocked',
          risk: action.risk,
          category: action.category,
        },
      };
    }
  }

  // Revalidate the authorization immediately before handing control to the
  // tool. This consumes one-time grants and checks emergency stop again.
  const validation = await permissionManager.beginExecution(authorization, {
    agentId: input.agent.id,
    toolName: input.toolName,
    category: action.category,
  });

  if (!validation.ok) {
    return {
      success: false,
      content: toolFail(validation.message),
      trace: `BLOCKED ${input.toolName}`,
      durationMs: 0,
      error: validation.message,
      permission: {
        requestId: outcome.request.id,
        allowed: false,
        reason: validation.reason,
        risk: action.risk,
        category: action.category,
      },
    };
  }

  const start = Date.now();
  const timeoutMs = executionTimeoutFor(action.category);

  try {
    const execution = await withTimeout(input.execute(), timeoutMs);
    const durationMs = Date.now() - start;
    await permissionManager.finishExecution(authorization, true);

    return {
      success: true,
      content: execution.content,
      trace: execution.trace,
      durationMs,
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
    const message =
      error instanceof ExecutionTimeoutError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Tool execution failed.';

    await permissionManager.finishExecution(authorization, false, truncate(message, 300));

    return {
      success: false,
      content: toolFail(message),
      trace: `FAILED ${input.toolName}`,
      durationMs,
      error: message,
      permission: {
        requestId: outcome.request.id,
        allowed: true,
        via: outcome.via,
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
  return {
    success: false,
    content: toolFail(message),
    trace: `DENIED ${toolName}`,
    durationMs: 0,
    error: message,
    permission: {
      requestId: null,
      allowed: false,
      reason: 'policy_denied',
      risk,
      category,
    },
  };
}
