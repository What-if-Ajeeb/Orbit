import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { listDynamicAgents } from './agents';
import { PermissionStore } from './store';
import type {
  PermissionAuditEvent,
  PermissionAuthorization,
  PermissionCategory,
  PermissionDashboardData,
  PermissionDecisionOption,
  PermissionDenialReason,
  PermissionGrantRecord,
  PermissionOutcome,
  PermissionRequestRecord,
  PermissionResolution,
  PermissionState,
  RiskLevel,
  ToolPermissionRequest,
} from './types';

const REQUEST_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_TTL_MS = 60 * 1000;
const ONCE_GRANT_TTL_MS = 2 * 60 * 1000;
const PERSISTENT_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type PendingWaiter = {
  request: PermissionRequestRecord;
  resolve: (outcome: PermissionOutcome) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

type ActiveAuthorization = {
  authorization: PermissionAuthorization;
  timer: ReturnType<typeof setTimeout> | null;
};

type ResolveResult = {
  ok: boolean;
  message?: string;
};

type BeginExecutionResult =
  | { ok: true; request: PermissionRequestRecord }
  | { ok: false; reason: PermissionDenialReason; message: string };

type AuditInput = {
  userId: number;
  requestId?: string | null;
  grantId?: string | null;
  agentId?: string | null;
  event: PermissionAuditEvent;
  category?: PermissionCategory | null;
  risk?: RiskLevel | null;
  toolName?: string | null;
  projectId?: string | null;
  detail: string;
  createdAt?: number;
};

function denial(
  reason: PermissionDenialReason,
  message: string,
  request?: PermissionRequestRecord
): PermissionOutcome {
  return { allowed: false, reason, message, request };
}

export class PermissionManager {
  private db: SQLiteDatabase | null = null;
  private store: PermissionStore | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, PendingWaiter>();
  private authorizations = new Map<string, ActiveAuthorization>();
  private listeners = new Set<() => void>();
  private state: PermissionState = {
    queue: [],
    emergencyStop: false,
    emergencyStopReason: null,
    loading: true,
    revision: 0,
  };

  attach(db: SQLiteDatabase): void {
    if (this.db === db) {
      return;
    }

    this.db = db;
    this.store = new PermissionStore(db);
    this.ready = this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    if (!this.store) {
      return;
    }

    try {
      const now = Date.now();
      await this.store.expireGrants(now);
      // Pending promises do not survive a JS restart. Mark orphaned requests
      // expired so the dashboard never shows an unanswerable prompt.
      await this.store.expireOrphanedRequests(now);
      await this.store.expireStaleRequests(now);
      const stopped = (await this.store.getState('emergency_stop')) === '1';
      const reason = await this.store.getState('emergency_stop_reason');

      this.state = {
        ...this.state,
        emergencyStop: stopped,
        emergencyStopReason: reason,
        loading: false,
        revision: this.state.revision + 1,
      };
      this.emit();
    } catch (error) {
      console.warn('Could not load the permission service state.', error);
      this.state = { ...this.state, loading: false, revision: this.state.revision + 1 };
      this.emit();
    }
  }

  private async ensureReady(): Promise<boolean> {
    if (!this.store || !this.db) {
      return false;
    }

    if (this.ready) {
      await this.ready;
    }

    return true;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getState(): PermissionState {
    return this.state;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private updateState(patch: Partial<PermissionState>): void {
    this.state = {
      ...this.state,
      ...patch,
      revision: this.state.revision + 1,
    };
    this.emit();
  }

  private refreshQueue(): void {
    const queue = Array.from(this.pending.values())
      .map((waiter) => waiter.request)
      .sort((a, b) => a.createdAt - b.createdAt);
    this.updateState({ queue });
  }

  private async audit(input: AuditInput): Promise<void> {
    if (!this.store) {
      return;
    }

    try {
      await this.store.addAudit({
        userId: input.userId,
        requestId: input.requestId ?? null,
        grantId: input.grantId ?? null,
        agentId: input.agentId ?? null,
        event: input.event,
        category: input.category ?? null,
        risk: input.risk ?? null,
        toolName: input.toolName ?? null,
        projectId: input.projectId ?? null,
        detail: input.detail,
        createdAt: input.createdAt,
      });
    } catch (error) {
      console.warn('Could not write the permission audit entry.', error);
    }
  }

  async recordAudit(input: AuditInput): Promise<void> {
    await this.audit(input);
  }

  private requestRecord(
    input: ToolPermissionRequest,
    status: PermissionRequestRecord['status'],
    now: number,
    resolution: PermissionResolution | null = null
  ): PermissionRequestRecord {
    const action = input.action;

    return {
      id: `req_${Crypto.randomUUID()}`,
      userId: input.userId,
      agentId: action.agent.id,
      agentName: action.agent.name,
      agentRole: action.agent.role,
      category: action.category,
      risk: action.risk,
      toolName: action.toolName,
      projectId: action.projectId,
      projectLabel: action.projectLabel,
      conversationId: input.conversationId ?? null,
      title: action.title,
      summary: action.summary,
      actions: action.actions,
      target: action.target,
      reason: action.reason,
      commandPreview: action.commandPreview,
      scopeKey: action.scopeKey,
      allowAlways: action.allowAlways,
      status,
      resolution,
      createdAt: now,
      expiresAt: now + REQUEST_TTL_MS,
      resolvedAt: status === 'pending' ? null : now,
      metadata: action.metadata,
    };
  }

  private issueAuthorization(
    request: PermissionRequestRecord,
    grant: PermissionGrantRecord | null
  ): PermissionAuthorization {
    const now = Date.now();
    const grantExpiry = grant?.expiresAt ?? Number.MAX_SAFE_INTEGER;
    const authorization: PermissionAuthorization = {
      id: `auth_${Crypto.randomUUID()}`,
      requestId: request.id,
      grantId: grant?.id ?? null,
      userId: request.userId,
      agentId: request.agentId,
      agentName: request.agentName,
      toolName: request.toolName,
      category: request.category,
      risk: request.risk,
      scopeKey: request.scopeKey,
      projectId: request.projectId,
      once: grant ? grant.scope === 'once' : true,
      issuedAt: now,
      expiresAt: Math.min(now + AUTHORIZATION_TTL_MS, grantExpiry),
    };
    const timer = setTimeout(() => {
      this.expireAuthorization(authorization.id);
    }, Math.max(0, authorization.expiresAt - now));

    this.authorizations.set(authorization.id, { authorization, timer });
    return authorization;
  }

  private expireAuthorization(id: string): void {
    const entry = this.authorizations.get(id);

    if (!entry) {
      return;
    }

    this.authorizations.delete(id);

    // If the agent never executed the approved action, surface that in the
    // audit trail instead of leaving a misleading "approved" request behind.
    void (async () => {
      if (!this.store) {
        return;
      }

      try {
        const request = await this.store.getRequest(entry.authorization.requestId);

        if (
          request &&
          (request.status === 'approved_once' ||
            request.status === 'approved_always' ||
            request.status === 'auto_approved')
        ) {
          await this.store.updateRequestStatus(request.id, 'expired', 'cancel', Date.now());
          await this.audit({
            userId: request.userId,
            requestId: request.id,
            grantId: entry.authorization.grantId,
            agentId: request.agentId,
            event: 'expired',
            category: request.category,
            risk: request.risk,
            toolName: request.toolName,
            projectId: request.projectId,
            detail: 'The approval expired before execution.',
          });
        }
      } catch (error) {
        console.warn('Could not expire a permission authorization.', error);
      }
    })();
  }

  async requestToolPermission(input: ToolPermissionRequest): Promise<PermissionOutcome> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return denial('invalid_request', 'The permission service is not ready, so the action was blocked.');
    }

    const action = input.action;
    const now = Date.now();

    if (this.state.emergencyStop) {
      await this.audit({
        userId: input.userId,
        agentId: action.agent.id,
        event: 'execution_blocked',
        category: action.category,
        risk: action.risk,
        toolName: action.toolName,
        projectId: action.projectId,
        detail: `Blocked by emergency stop: ${action.title}`,
      });
      return denial(
        'emergency_stop',
        'Emergency stop is active. No agent actions can run until the user resumes permissions.'
      );
    }

    if (input.policy.decision === 'deny') {
      await this.audit({
        userId: input.userId,
        agentId: action.agent.id,
        event: 'denied',
        category: action.category,
        risk: action.risk,
        toolName: action.toolName,
        projectId: action.projectId,
        detail: `Policy denied the action: ${input.policy.reason ?? 'deny rule'}`,
      });
      return denial(
        'policy_denied',
        `Blocked by policy: ${input.policy.reason ?? 'this action is not allowed.'}`
      );
    }

    if (action.risk !== 'high') {
      const existingGrant = await this.store.findMatchingGrant({
        userId: input.userId,
        agentId: action.agent.id,
        toolName: action.toolName,
        category: action.category,
        projectId: action.projectId,
        scopeKey: action.scopeKey,
        now,
      });

      if (existingGrant) {
        const request = this.requestRecord(input, 'auto_approved', now, 'existing_grant');
        await this.store.insertRequest(request);
        await this.audit({
          userId: input.userId,
          requestId: request.id,
          grantId: existingGrant.id,
          agentId: action.agent.id,
          event: 'request_auto_approved',
          category: action.category,
          risk: action.risk,
          toolName: action.toolName,
          projectId: action.projectId,
          detail: `Reused a saved ${action.category} grant for ${action.agent.name}.`,
        });
        return {
          allowed: true,
          authorization: this.issueAuthorization(request, existingGrant),
          request,
          via: 'existing_grant',
        };
      }
    }

    const explicitAllow =
      input.policy.decision === 'allow' &&
      action.risk !== 'high' &&
      (input.policy.ruleId !== null || action.autoApprove);

    if (explicitAllow) {
      const request = this.requestRecord(input, 'auto_approved', now, 'auto_grant');
      await this.store.insertRequest(request);
      await this.audit({
        userId: input.userId,
        requestId: request.id,
        agentId: action.agent.id,
        event: 'request_auto_approved',
        category: action.category,
        risk: action.risk,
        toolName: action.toolName,
        projectId: action.projectId,
        detail: `Auto-approved low-risk action for ${action.agent.name}: ${action.title}`,
      });
      return {
        allowed: true,
        authorization: this.issueAuthorization(request, null),
        request,
        via: 'auto',
      };
    }

    const request = this.requestRecord(input, 'pending', now);
    await this.store.insertRequest(request);
    await this.audit({
      userId: input.userId,
      requestId: request.id,
      agentId: action.agent.id,
      event: 'request_created',
      category: action.category,
      risk: action.risk,
      toolName: action.toolName,
      projectId: action.projectId,
      detail: `${action.agent.name} requested: ${action.title}`,
    });

    return new Promise<PermissionOutcome>((resolve) => {
      const waiter: PendingWaiter = { request, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        this.expirePending(request.id);
      }, REQUEST_TTL_MS);
      this.pending.set(request.id, waiter);
      this.refreshQueue();
    });
  }

  async resolveRequest(
    requestId: string,
    option: PermissionDecisionOption,
    userId?: number
  ): Promise<ResolveResult> {
    const ready = await this.ensureReady();
    const waiter = this.pending.get(requestId);

    if (!ready || !this.store || !waiter) {
      return { ok: false, message: 'This request is no longer pending.' };
    }

    const request = waiter.request;

    if (userId !== undefined && request.userId !== userId) {
      return { ok: false, message: 'This request belongs to another user.' };
    }

    if (option === 'deny') {
      const resolvedAt = Date.now();
      await this.store.updateRequestStatus(request.id, 'denied', 'deny', resolvedAt);
      await this.audit({
        userId: request.userId,
        requestId: request.id,
        agentId: request.agentId,
        event: 'denied',
        category: request.category,
        risk: request.risk,
        toolName: request.toolName,
        projectId: request.projectId,
        detail: `${request.agentName} was denied: ${request.title}`,
      });
      this.settle(request.id, { ...request, status: 'denied', resolution: 'deny', resolvedAt });
      waiter.resolve(
        denial('user_denied', `${request.agentName} was not given permission for this action.`, {
          ...request,
          status: 'denied',
          resolution: 'deny',
          resolvedAt,
        })
      );
      return { ok: true };
    }

    if (option === 'always_allow') {
      if (request.risk === 'high' || !request.allowAlways) {
        return {
          ok: false,
          message: 'High-risk actions must be approved one time, every time.',
        };
      }

      const now = Date.now();
      const grant: PermissionGrantRecord = {
        id: `grant_${Crypto.randomUUID()}`,
        userId: request.userId,
        requestId: request.id,
        agentId: request.agentId,
        agentName: request.agentName,
        toolName: request.toolName,
        category: request.category,
        scopeKey: request.scopeKey,
        projectId: request.projectId,
        projectLabel: request.projectLabel,
        scope: 'persistent',
        risk: request.risk,
        title: request.title,
        createdAt: now,
        expiresAt: now + PERSISTENT_GRANT_TTL_MS,
        lastUsedAt: null,
        useCount: 0,
        maxUses: null,
        revokedAt: null,
        status: 'active',
      };

      await this.store.insertGrant(grant);
      const resolvedRequest: PermissionRequestRecord = {
        ...request,
        status: 'approved_always',
        resolution: 'always_allow',
        resolvedAt: now,
      };
      await this.store.updateRequestStatus(request.id, 'approved_always', 'always_allow', now);
      await this.audit({
        userId: request.userId,
        requestId: request.id,
        grantId: grant.id,
        agentId: request.agentId,
        event: 'approved_always',
        category: request.category,
        risk: request.risk,
        toolName: request.toolName,
        projectId: request.projectId,
        detail: `Saved a scoped grant for ${request.agentName} · ${request.category} · ${request.projectLabel}.`,
      });
      this.settle(request.id, resolvedRequest);
      waiter.resolve({
        allowed: true,
        authorization: this.issueAuthorization(resolvedRequest, grant),
        request: resolvedRequest,
        via: 'always_allow',
      });
      return { ok: true };
    }

    const now = Date.now();
    const grant: PermissionGrantRecord = {
      id: `grant_${Crypto.randomUUID()}`,
      userId: request.userId,
      requestId: request.id,
      agentId: request.agentId,
      agentName: request.agentName,
      toolName: request.toolName,
      category: request.category,
      scopeKey: request.scopeKey,
      projectId: request.projectId,
      projectLabel: request.projectLabel,
      scope: 'once',
      risk: request.risk,
      title: request.title,
      createdAt: now,
      expiresAt: now + ONCE_GRANT_TTL_MS,
      lastUsedAt: null,
      useCount: 0,
      maxUses: 1,
      revokedAt: null,
      status: 'active',
    };

    await this.store.insertGrant(grant);
    const resolvedRequest: PermissionRequestRecord = {
      ...request,
      status: 'approved_once',
      resolution: 'allow_once',
      resolvedAt: now,
    };
    await this.store.updateRequestStatus(request.id, 'approved_once', 'allow_once', now);
    await this.audit({
      userId: request.userId,
      requestId: request.id,
      grantId: grant.id,
      agentId: request.agentId,
      event: 'approved_once',
      category: request.category,
      risk: request.risk,
      toolName: request.toolName,
      projectId: request.projectId,
      detail: `${request.agentName} approved once: ${request.title}`,
    });
    this.settle(request.id, resolvedRequest);
    waiter.resolve({
      allowed: true,
      authorization: this.issueAuthorization(resolvedRequest, grant),
      request: resolvedRequest,
      via: 'allow_once',
    });
    return { ok: true };
  }

  async cancelRequest(requestId: string, userId?: number): Promise<ResolveResult> {
    const ready = await this.ensureReady();
    const waiter = this.pending.get(requestId);

    if (!ready || !this.store || !waiter) {
      return { ok: false, message: 'This request is no longer pending.' };
    }

    const request = waiter.request;

    if (userId !== undefined && request.userId !== userId) {
      return { ok: false, message: 'This request belongs to another user.' };
    }

    const resolvedAt = Date.now();
    await this.store.updateRequestStatus(request.id, 'cancelled', 'cancel', resolvedAt);
    await this.audit({
      userId: request.userId,
      requestId: request.id,
      agentId: request.agentId,
      event: 'cancelled',
      category: request.category,
      risk: request.risk,
      toolName: request.toolName,
      projectId: request.projectId,
      detail: `The user cancelled ${request.agentName}’s pending request.`,
    });
    const resolvedRequest: PermissionRequestRecord = {
      ...request,
      status: 'cancelled',
      resolution: 'cancel',
      resolvedAt,
    };
    this.settle(request.id, resolvedRequest);
    waiter.resolve(
      denial('user_cancelled', 'The user cancelled this permission request.', resolvedRequest)
    );
    return { ok: true };
  }

  private settle(requestId: string, request: PermissionRequestRecord): void {
    const waiter = this.pending.get(requestId);

    if (waiter?.timer) {
      clearTimeout(waiter.timer);
    }

    this.pending.delete(requestId);
    this.refreshQueue();
    void request;
  }

  private expirePending(requestId: string): void {
    const waiter = this.pending.get(requestId);

    if (!waiter || !this.store) {
      return;
    }

    const request = waiter.request;
    const now = Date.now();
    const resolvedRequest: PermissionRequestRecord = {
      ...request,
      status: 'expired',
      resolution: 'cancel',
      resolvedAt: now,
    };

    void (async () => {
      await this.store?.updateRequestStatus(request.id, 'expired', 'cancel', now);
      await this.audit({
        userId: request.userId,
        requestId: request.id,
        agentId: request.agentId,
        event: 'expired',
        category: request.category,
        risk: request.risk,
        toolName: request.toolName,
        projectId: request.projectId,
        detail: `The request expired without a decision: ${request.title}`,
      });
    })();

    this.settle(request.id, resolvedRequest);
    waiter.resolve(
      denial('expired', 'This permission request expired before it was answered.', resolvedRequest)
    );
  }

  async beginExecution(
    authorization: PermissionAuthorization,
    expected: { agentId: string; toolName: string; category: PermissionCategory }
  ): Promise<BeginExecutionResult> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return { ok: false, reason: 'invalid_request', message: 'The permission service is not ready.' };
    }

    if (this.state.emergencyStop) {
      await this.audit({
        userId: authorization.userId,
        requestId: authorization.requestId,
        grantId: authorization.grantId,
        agentId: authorization.agentId,
        event: 'execution_blocked',
        category: authorization.category,
        risk: authorization.risk,
        toolName: authorization.toolName,
        projectId: authorization.projectId,
        detail: 'Execution blocked because emergency stop is active.',
      });
      return {
        ok: false,
        reason: 'emergency_stop',
        message: 'Emergency stop is active. Execution was blocked.',
      };
    }

    const active = this.authorizations.get(authorization.id);

    if (!active) {
      return {
        ok: false,
        reason: 'authorization_expired',
        message: 'This approval has already been used or expired. Ask for permission again.',
      };
    }

    if (Date.now() > authorization.expiresAt) {
      this.authorizations.delete(authorization.id);
      if (active.timer) {
        clearTimeout(active.timer);
      }
      return {
        ok: false,
        reason: 'authorization_expired',
        message: 'This approval expired before execution. Ask for permission again.',
      };
    }

    if (
      authorization.agentId !== expected.agentId ||
      authorization.toolName !== expected.toolName ||
      authorization.category !== expected.category
    ) {
      await this.audit({
        userId: authorization.userId,
        requestId: authorization.requestId,
        grantId: authorization.grantId,
        agentId: authorization.agentId,
        event: 'execution_blocked',
        category: authorization.category,
        risk: authorization.risk,
        toolName: authorization.toolName,
        projectId: authorization.projectId,
        detail: 'Authorization scope did not match the requested execution.',
      });
      return {
        ok: false,
        reason: 'scope_mismatch',
        message: 'The approval does not match this agent, tool, or action category.',
      };
    }

    const request = await this.store.getRequest(authorization.requestId);

    if (
      !request ||
      request.userId !== authorization.userId ||
      !['approved_once', 'approved_always', 'auto_approved'].includes(request.status)
    ) {
      return {
        ok: false,
        reason: 'authorization_invalid',
        message: 'The underlying permission request is no longer valid.',
      };
    }

    if (authorization.grantId) {
      const grant = await this.store.getGrant(authorization.grantId);

      if (
        !grant ||
        grant.status !== 'active' ||
        grant.revokedAt !== null ||
        (grant.expiresAt !== null && grant.expiresAt <= Date.now()) ||
        grant.agentId !== authorization.agentId ||
        grant.toolName !== authorization.toolName ||
        grant.category !== authorization.category ||
        grant.scopeKey !== authorization.scopeKey ||
        grant.projectId !== authorization.projectId ||
        (grant.maxUses !== null && grant.useCount >= grant.maxUses)
      ) {
        return {
          ok: false,
          reason: grant?.status === 'revoked' ? 'grant_revoked' : 'authorization_invalid',
          message: 'The saved permission is no longer valid. Ask for permission again.',
        };
      }

      const consume = grant.scope === 'once';
      await this.store.markGrantUsed(grant.id, Date.now(), consume);

      if (consume) {
        await this.audit({
          userId: authorization.userId,
          requestId: request.id,
          grantId: grant.id,
          agentId: authorization.agentId,
          event: 'grant_consumed',
          category: authorization.category,
          risk: authorization.risk,
          toolName: authorization.toolName,
          projectId: authorization.projectId,
          detail: 'The one-time permission was consumed at execution.',
        });
      }
    }

    this.authorizations.delete(authorization.id);

    if (active.timer) {
      clearTimeout(active.timer);
    }

    await this.store.updateRequestStatus(request.id, 'executing');
    await this.audit({
      userId: authorization.userId,
      requestId: request.id,
      grantId: authorization.grantId,
      agentId: authorization.agentId,
      event: 'execution_authorized',
      category: authorization.category,
      risk: authorization.risk,
      toolName: authorization.toolName,
      projectId: authorization.projectId,
      detail: `Revalidated and authorized ${authorization.agentName} to execute ${authorization.toolName}.`,
    });

    return { ok: true, request: { ...request, status: 'executing' } };
  }

  async finishExecution(
    authorization: PermissionAuthorization,
    success: boolean,
    error?: string
  ): Promise<void> {
    if (!this.store) {
      return;
    }

    const status = success ? 'completed' : 'failed';
    await this.store.updateRequestStatus(authorization.requestId, status, null, Date.now());
    await this.audit({
      userId: authorization.userId,
      requestId: authorization.requestId,
      grantId: authorization.grantId,
      agentId: authorization.agentId,
      event: success ? 'execution_completed' : 'execution_failed',
      category: authorization.category,
      risk: authorization.risk,
      toolName: authorization.toolName,
      projectId: authorization.projectId,
      detail: success
        ? `Execution completed for ${authorization.toolName}.`
        : `Execution failed for ${authorization.toolName}: ${error ?? 'unknown error'}`,
    });
  }

  async blockExecution(
    authorization: PermissionAuthorization,
    reason: PermissionDenialReason,
    message: string
  ): Promise<void> {
    if (!this.store) {
      return;
    }

    await this.store.updateRequestStatus(authorization.requestId, 'blocked', 'cancel', Date.now());
    await this.audit({
      userId: authorization.userId,
      requestId: authorization.requestId,
      grantId: authorization.grantId,
      agentId: authorization.agentId,
      event:
        reason === 'android_permission_denied'
          ? 'android_permission_denied'
          : 'execution_blocked',
      category: authorization.category,
      risk: authorization.risk,
      toolName: authorization.toolName,
      projectId: authorization.projectId,
      detail: message,
    });
  }

  async emergencyStop(userId: number, reason = 'User stopped all agent execution'): Promise<void> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return;
    }

    await this.store.setState('emergency_stop', '1');
    await this.store.setState('emergency_stop_reason', reason);
    this.invalidateAllAuthorizations();
    this.updateState({ emergencyStop: true, emergencyStopReason: reason });
    await this.audit({
      userId,
      event: 'emergency_stop',
      detail: reason,
    });

    const pending = Array.from(this.pending.values());
    for (const waiter of pending) {
      const request = waiter.request;
      const resolvedAt = Date.now();
      const resolvedRequest: PermissionRequestRecord = {
        ...request,
        status: 'cancelled',
        resolution: 'emergency_stop',
        resolvedAt,
      };
      await this.store.updateRequestStatus(request.id, 'cancelled', 'emergency_stop', resolvedAt);
      this.settle(request.id, resolvedRequest);
      waiter.resolve(
        denial('emergency_stop', 'Emergency stop is active. The request was cancelled.', resolvedRequest)
      );
    }
  }

  async resumePermissions(userId: number): Promise<void> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return;
    }

    await this.store.setState('emergency_stop', '0');
    await this.store.setState('emergency_stop_reason', '');
    this.updateState({ emergencyStop: false, emergencyStopReason: null });
    await this.audit({
      userId,
      event: 'emergency_resume',
      detail: 'The user resumed agent execution.',
    });
  }

  async revokeGrant(userId: number, grantId: string): Promise<boolean> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return false;
    }

    const grant = await this.store.getGrant(grantId);
    const revoked = await this.store.revokeGrant(grantId, userId, Date.now());

    if (revoked && grant) {
      this.invalidateAuthorizationsForGrant(grantId);
      await this.audit({
        userId,
        grantId,
        requestId: grant.requestId,
        agentId: grant.agentId,
        event: 'grant_revoked',
        category: grant.category,
        risk: grant.risk,
        toolName: grant.toolName,
        projectId: grant.projectId,
        detail: `Revoked a saved ${grant.category} grant for ${grant.agentName}.`,
      });
    }

    return revoked;
  }

  async revokeAgentGrants(userId: number, agentId: string): Promise<number> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return 0;
    }

    const count = await this.store.revokeAgentGrants(userId, agentId, Date.now());
    this.invalidateAuthorizationsForAgent(agentId);
    await this.audit({
      userId,
      agentId,
      event: 'grant_revoked',
      detail: `Revoked ${count} saved permission${count === 1 ? '' : 's'}.`,
    });
    return count;
  }

  async revokeAllGrants(userId: number): Promise<number> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return 0;
    }

    const count = await this.store.revokeAllGrants(userId, Date.now());
    this.invalidateAllAuthorizations();
    await this.audit({
      userId,
      event: 'grant_revoked',
      detail: `Revoked all ${count} saved permissions.`,
    });
    return count;
  }

  private invalidateAuthorizationsForGrant(grantId: string): void {
    for (const [id, entry] of this.authorizations) {
      if (entry.authorization.grantId === grantId) {
        if (entry.timer) {
          clearTimeout(entry.timer);
        }
        this.authorizations.delete(id);
      }
    }
  }

  private invalidateAuthorizationsForAgent(agentId: string): void {
    for (const [id, entry] of this.authorizations) {
      if (entry.authorization.agentId === agentId) {
        if (entry.timer) {
          clearTimeout(entry.timer);
        }
        this.authorizations.delete(id);
      }
    }
  }

  private invalidateAllAuthorizations(): void {
    for (const entry of this.authorizations.values()) {
      if (entry.timer) {
        clearTimeout(entry.timer);
      }
    }

    this.authorizations.clear();
  }

  async getDashboard(userId: number): Promise<PermissionDashboardData> {
    const ready = await this.ensureReady();

    if (!ready || !this.store || !this.db) {
      return {
        grants: [],
        requests: [],
        audit: [],
        devices: [],
        dynamicAgents: [],
        emergencyStop: this.state.emergencyStop,
        emergencyStopReason: this.state.emergencyStopReason,
        pending: [],
      };
    }

    const now = Date.now();
    await this.store.expireGrants(now);
    await this.store.expireStaleRequests(now);
    const [grants, requests, audit, devices, dynamicAgents] = await Promise.all([
      this.store.listGrants(userId),
      this.store.listRequests(userId),
      this.store.listAudit(userId),
      this.store.listDevices(userId),
      listDynamicAgents(this.db, userId),
    ]);

    return {
      grants,
      requests,
      audit,
      devices,
      dynamicAgents,
      emergencyStop: this.state.emergencyStop,
      emergencyStopReason: this.state.emergencyStopReason,
      pending: Array.from(this.pending.values())
        .map((waiter) => waiter.request)
        .filter((request) => request.userId === userId),
    };
  }

  getPendingForUser(userId: number): PermissionRequestRecord[] {
    return Array.from(this.pending.values())
      .map((waiter) => waiter.request)
      .filter((request) => request.userId === userId);
  }

  isEmergencyStopped(): boolean {
    return this.state.emergencyStop;
  }
}

export const permissionManager = new PermissionManager();
