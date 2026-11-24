import { pluginApprovalService } from '@/lib/plugins/approvals';
import type { PluginPermission, PluginTrustLevel } from '@/lib/plugins/types';

import nativeTransport from './native';
import {
  SandboxApprovalDeniedError,
  SandboxBridgeError,
  type SandboxExecutionResult,
  type SandboxPolicyDescription,
  type SandboxProgramManifest,
  type SandboxSnapshot,
  type SandboxSession,
  type SandboxTransport,
  type SandboxValidationReport,
} from './types';

const MAX_SESSIONS = 12;

type ApprovalRequester = (input: {
  pluginId: string;
  pluginName: string;
  trustLevel: PluginTrustLevel;
  permissions: PluginPermission[];
  reason: string;
}) => Promise<boolean>;

export type MobileSandboxOptions = {
  transport?: SandboxTransport;
  requestApproval?: ApprovalRequester;
  now?: () => number;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected sandbox failure.';
}

function parseResponse<T>(raw: string): T {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new SandboxBridgeError('invalid_response', 'Sandbox returned malformed JSON.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new SandboxBridgeError('invalid_response', 'Sandbox returned an invalid response.');
  }

  const response = parsed as {
    ok?: unknown;
    result?: T;
    error?: { code?: string; message?: string };
  };

  if (response.error) {
    throw new SandboxBridgeError(
      response.error.code ?? 'sandbox_error',
      response.error.message ?? 'Sandbox call failed.'
    );
  }

  if (response.ok !== true || response.result === undefined) {
    throw new SandboxBridgeError('sandbox_call_failed', 'Sandbox call did not return a result.');
  }

  return response.result;
}

function displayName(pluginId: string): string {
  return pluginId.split(/[.-]/).filter(Boolean).slice(-2).join(' ') || pluginId;
}

/**
 * Host-side owner of the Android sandbox. It validates every program before
 * execution, asks the existing ORBIT approval host for `sandbox.execute`, keeps
 * a bounded session history, and never exposes plugin code to the RN runtime.
 */
export class MobileSandboxManager {
  private readonly transport: SandboxTransport;
  private readonly requestApproval: ApprovalRequester;
  private readonly now: () => number;

  private description: SandboxPolicyDescription | null = null;
  private sessions: SandboxSession[] = [];
  private lastError: string | null = null;
  private busy = 0;
  private snapshot: SandboxSnapshot | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(options: MobileSandboxOptions = {}) {
    this.transport = options.transport ?? nativeTransport;
    this.requestApproval =
      options.requestApproval ??
      ((input) =>
        pluginApprovalService.requestPermissions({
          pluginId: input.pluginId,
          pluginName: input.pluginName,
          trustLevel: input.trustLevel,
          permissions: input.permissions,
          reason: input.reason,
        }));
    this.now = options.now ?? Date.now;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): SandboxSnapshot => {
    if (!this.snapshot) {
      this.snapshot = {
        description: this.description,
        sessions: [...this.sessions],
        lastError: this.lastError,
        busy: this.busy,
      };
    }

    return this.snapshot;
  };

  private emitChange(): void {
    this.snapshot = null;
    for (const listener of Array.from(this.listeners)) {
      try {
        listener();
      } catch {
        // A broken listener must not block sandbox state updates.
      }
    }
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    this.busy += 1;
    this.emitChange();

    try {
      const value = await operation();
      this.lastError = null;
      return value;
    } catch (error) {
      this.lastError = errorMessage(error);
      throw error;
    } finally {
      this.busy = Math.max(0, this.busy - 1);
      this.emitChange();
    }
  }

  async initialize(): Promise<SandboxPolicyDescription> {
    if (this.description) {
      return this.description;
    }

    const description = await this.run(async () =>
      parseResponse<SandboxPolicyDescription>(await this.transport.describe())
    );
    this.description = description;
    this.emitChange();
    return description;
  }

  async validate(manifest: SandboxProgramManifest): Promise<SandboxValidationReport> {
    return this.run(async () =>
      parseResponse<SandboxValidationReport>(
        await this.transport.validateManifest(JSON.stringify(manifest))
      )
    );
  }

  async execute(
    manifest: SandboxProgramManifest,
    input: Record<string, unknown> = {}
  ): Promise<SandboxExecutionResult> {
    const validation = await this.validate(manifest);

    if (!validation.ok) {
      throw new SandboxBridgeError(
        'manifest_invalid',
        validation.errors.join(' ') || 'Sandbox manifest was rejected.'
      );
    }

    const approved = await this.requestApproval({
      pluginId: manifest.pluginId,
      pluginName: displayName(manifest.pluginId),
      trustLevel: 'untrusted',
      permissions: ['sandbox.execute'],
      reason: `Run sandbox program ${manifest.pluginId}@${manifest.version}? It has no file, network or device-permission access.`,
    });

    if (!approved) {
      throw new SandboxApprovalDeniedError();
    }

    const session: SandboxSession = {
      id: `sandbox-${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pluginId: manifest.pluginId,
      version: manifest.version,
      status: 'running',
      startedAt: this.now(),
    };
    this.sessions = [session, ...this.sessions].slice(0, MAX_SESSIONS);
    this.emitChange();

    try {
      const result = await this.run(async () =>
        parseResponse<SandboxExecutionResult>(
          await this.transport.execute(JSON.stringify({ manifest, input }))
        )
      );

      this.patchSession(session.id, {
        status: result.ok ? 'completed' : 'rejected',
        finishedAt: this.now(),
        instructionsExecuted: result.instructionsExecuted,
        outputs: result.outputs,
        errors: result.errors,
      });

      return result;
    } catch (error) {
      this.patchSession(session.id, {
        status: 'failed',
        finishedAt: this.now(),
        errors: [errorMessage(error)],
      });
      throw error;
    }
  }

  /** Unbinds the isolated service and clears host-side session state. */
  async shutdown(): Promise<void> {
    try {
      await this.run(async () => {
        await this.transport.shutdown();
        return true;
      });
    } finally {
      this.sessions = [];
      this.description = null;
      this.emitChange();
    }
  }

  /** Clears local session history without unbinding the native service. */
  clearHistory(): void {
    this.sessions = [];
    this.emitChange();
  }

  private patchSession(id: string, patch: Partial<SandboxSession>): void {
    this.sessions = this.sessions.map((session) =>
      session.id === id ? { ...session, ...patch } : session
    );
    this.emitChange();
  }
}

let shared: MobileSandboxManager | null = null;

export function getMobileSandboxManager(): MobileSandboxManager {
  if (!shared) {
    shared = new MobileSandboxManager();
  }
  return shared;
}

export async function disposeMobileSandboxManager(): Promise<void> {
  const current = shared;
  shared = null;
  await current?.shutdown();
}
