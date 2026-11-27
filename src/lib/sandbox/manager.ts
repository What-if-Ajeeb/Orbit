import * as Crypto from 'expo-crypto';

import { pluginApprovalService } from '@/lib/plugins/approvals';
import type { PluginPermission, PluginTrustLevel } from '@/lib/plugins/types';

import nativeTransport from './native';
import {
  SandboxApprovalDeniedError,
  SandboxBridgeError,
  SandboxOperationDeniedError,
  type SandboxApprovalEvidence,
  type SandboxAuditRecord,
  type SandboxAuthorizeRequest,
  type SandboxFileReadRequest,
  type SandboxFileReadResult,
  type SandboxManifest,
  type SandboxNetworkReport,
  type SandboxOperationDecision,
  type SandboxPathReport,
  type SandboxPermission,
  type SandboxPermissionCheck,
  type SandboxPermissionRequest,
  type SandboxPolicyDescription,
  type SandboxRequestReport,
  type SandboxRequestValidation,
  type SandboxSession,
  type SandboxSnapshot,
  type SandboxTransport,
  type SandboxValidationReport,
} from './types';

const MAX_SESSIONS = 20;
const DEFAULT_APPROVAL_TTL_SECONDS = 300;

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
 * Host-side owner of the Android sandbox.
 *
 * It orchestrates validation and mediation calls, creates short-lived approval
 * evidence through the existing approval host, keeps a bounded session history,
 * and emits audit records. It never executes plugin code or guest instructions.
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
  private readonly auditListeners = new Set<(record: SandboxAuditRecord) => void>();

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

  /** Registers a sink for allow and deny audit records. */
  onAudit(listener: (record: SandboxAuditRecord) => void): () => void {
    this.auditListeners.add(listener);
    return () => {
      this.auditListeners.delete(listener);
    };
  }

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

  private emitAudit(record: SandboxAuditRecord | undefined): void {
    if (!record) return;

    for (const listener of Array.from(this.auditListeners)) {
      try {
        listener(record);
      } catch {
        // Audit delivery is best effort; the decision already happened.
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

  async validateManifest(manifest: SandboxManifest): Promise<SandboxValidationReport> {
    const report = await this.run(async () =>
      parseResponse<SandboxValidationReport>(
        await this.transport.validateManifest(JSON.stringify(manifest))
      )
    );
    this.emitAudit(report.audit);
    return report;
  }

  async checkPermission(
    request: SandboxPermissionRequest
  ): Promise<SandboxPermissionCheck> {
    const result = await this.run(async () =>
      parseResponse<SandboxPermissionCheck>(
        await this.transport.checkPermission(JSON.stringify(request))
      )
    );
    this.emitAudit(result.audit);
    return result;
  }

  async validatePath(path: string): Promise<SandboxPathReport> {
    const report = await this.run(async () =>
      parseResponse<SandboxPathReport>(
        await this.transport.validatePath(JSON.stringify({ path }))
      )
    );
    this.emitAudit(report.audit);
    return report;
  }

  async validateNetwork(url: string): Promise<SandboxNetworkReport> {
    const report = await this.run(async () =>
      parseResponse<SandboxNetworkReport>(
        await this.transport.validateNetwork(JSON.stringify({ url }))
      )
    );
    this.emitAudit(report.audit);
    return report;
  }

  async validateRequest(
    request: SandboxRequestValidation
  ): Promise<SandboxRequestReport> {
    const report = await this.run(async () =>
      parseResponse<SandboxRequestReport>(
        await this.transport.validateRequest(JSON.stringify(request))
      )
    );
    this.emitAudit(report.audit);
    return report;
  }

  async authorizeOperation(
    request: SandboxAuthorizeRequest
  ): Promise<SandboxOperationDecision> {
    const session = this.startSession(
      request.manifest.pluginId,
      request.operation
    );

    try {
      const decision = await this.run(async () =>
        parseResponse<SandboxOperationDecision>(
          await this.transport.authorizeOperation(JSON.stringify(request))
        )
      );
      this.finishSession(
        session.id,
        decision.decision === 'allow' ? 'allowed' : 'denied',
        decision.reasonCode,
        decision.audit
      );
      this.emitAudit(decision.audit);
      return decision;
    } catch (error) {
      this.finishSession(session.id, 'failed', 'bridge_failure');
      throw error;
    }
  }

  /**
   * Asks the existing ORBIT approval host for a short-lived decision bound to
   * one exact resource. Rust verifies both the grant and the binding; neither a
   * grant alone nor evidence for another path/URL can authorize an operation.
   */
  async requestOperationApproval(input: {
    pluginId: string;
    pluginName?: string;
    trustLevel: PluginTrustLevel;
    permission: SandboxPermission;
    resource: string;
    reason: string;
    ttlSeconds?: number;
  }): Promise<SandboxApprovalEvidence> {
    const approved = await this.requestApproval({
      pluginId: input.pluginId,
      pluginName: input.pluginName ?? displayName(input.pluginId),
      trustLevel: input.trustLevel,
      permissions: [input.permission as PluginPermission],
      reason: `${input.reason} Target: ${input.resource}`,
    });

    if (!approved) {
      throw new SandboxApprovalDeniedError();
    }

    const description = this.description;
    const policyTtl = description?.limits.approvalTtlSeconds ?? DEFAULT_APPROVAL_TTL_SECONDS;
    const ttlSeconds = Math.max(1, Math.min(input.ttlSeconds ?? policyTtl, policyTtl));
    const grantedAt = this.now();

    return {
      permission: input.permission,
      resource: input.resource,
      grantedAt,
      expiresAt: grantedAt + ttlSeconds * 1_000,
      // Rust requires this nonce to be non-empty and binds it to the audit
      // record. A timestamp alone can collide for approvals in the same tick.
      requestId: `sandbox-approval-${grantedAt}-${Crypto.randomUUID()}`,
    };
  }

  /**
   * Mediates a bounded file read. Rust decides; Kotlin performs the read only
   * after an allow and re-checks canonical containment, symlinks and size.
   */
  async readFile(request: SandboxFileReadRequest): Promise<SandboxFileReadResult> {
    const session = this.startSession(request.pluginId, 'file.read');

    try {
      const result = await this.run(async () =>
        parseResponse<SandboxFileReadResult>(
          await this.transport.readFile(JSON.stringify(request))
        )
      );
      this.finishSession(
        session.id,
        result.decision === 'allow' ? 'allowed' : 'denied',
        result.reasonCode,
        result.audit
      );
      this.emitAudit(result.audit);

      if (result.decision !== 'allow') {
        throw new SandboxOperationDeniedError(
          result.reasonCode,
          result.reason || 'Sandbox denied the file read.',
          result.audit
        );
      }

      return result;
    } catch (error) {
      if (error instanceof SandboxOperationDeniedError) {
        throw error;
      }

      this.finishSession(session.id, 'failed', 'bridge_failure');
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

  private startSession(pluginId: string, operation: string): SandboxSession {
    const session: SandboxSession = {
      id: `sandbox-${this.now()}-${Math.random().toString(36).slice(2, 8)}`,
      pluginId,
      operation,
      status: 'running',
      startedAt: this.now(),
    };
    this.sessions = [session, ...this.sessions].slice(0, MAX_SESSIONS);
    this.emitChange();
    return session;
  }

  private finishSession(
    id: string,
    status: SandboxSession['status'],
    reasonCode?: string,
    audit?: SandboxAuditRecord
  ): void {
    this.sessions = this.sessions.map((session) =>
      session.id === id
        ? {
            ...session,
            status,
            finishedAt: this.now(),
            reasonCode,
            audit,
          }
        : session
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
