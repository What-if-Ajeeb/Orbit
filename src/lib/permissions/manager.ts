import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { ActivityStore } from '../safety/activity';
import { SafetyStore } from '../safety/store';
import type {
  ActivityInput,
  ActivityRecord,
  ActiveOperation,
  OperationStopResult,
  OperationStopState,
  StopReport,
} from '../safety/types';

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
  PermissionPreferenceRecord,
  PermissionRequestRecord,
  PermissionResolution,
  PermissionState,
  RiskLevel,
  ToolPermissionRequest,
} from './types';

const REQUEST_TTL_MS = 10 * 60 * 1000;
const AUTHORIZATION_TTL_MS = 60 * 1000;
const ONCE_GRANT_TTL_MS = 2 * 60 * 1000;
const SESSION_GRANT_TTL_MS = 8 * 60 * 60 * 1000;
const PERSISTENT_GRANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type PendingWaiter = {
  request: PermissionRequestRecord;
  resolve: (outcome: PermissionOutcome) => void;
  timer: ReturnType<typeof setTimeout> | null;
  resolving: boolean;
  /** Changes when a stop force-claims the request, invalidating the prior decision. */
  decisionToken: symbol;
};

const DECISION_OPTIONS: PermissionDecisionOption[] = [
  'allow_once',
  'allow_session',
  'always_allow',
  'ask_every_time',
  'never_allow',
  'deny',
];

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

function parseStateJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function parseStateList(value: string | null): string[] {
  const parsed = parseStateJson<unknown>(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
}

export class PermissionManager {
  private db: SQLiteDatabase | null = null;
  private store: PermissionStore | null = null;
  private activityStore: ActivityStore | null = null;
  private safetyStore: SafetyStore | null = null;
  private ready: Promise<void> | null = null;
  private pending = new Map<string, PendingWaiter>();
  private authorizations = new Map<string, ActiveAuthorization>();
  private operations = new Map<string, { controller: AbortController; operation: ActiveOperation }>();
  private listeners = new Set<() => void>();
  private sessionId = '';
  private state: PermissionState = {
    queue: [],
    emergencyStop: false,
    emergencyStopReason: null,
    stoppedAgents: [],
    sessionId: '',
    activityRevision: 0,
    lastStopReport: null,
    loading: true,
    revision: 0,
  };

  attach(db: SQLiteDatabase): void {
    if (this.db === db) {
      return;
    }

    this.db = db;
    this.store = new PermissionStore(db);
    this.activityStore = new ActivityStore(db);
    this.safetyStore = new SafetyStore(db);
    this.ready = this.bootstrap();
  }

  private async bootstrap(): Promise<void> {
    if (!this.store) {
      return;
    }

    try {
      const now = Date.now();
      const storedSession = await this.store.getState('permission_session_id');
      this.sessionId = storedSession || `session_${Crypto.randomUUID()}`;

      if (!storedSession) {
        await this.store.setState('permission_session_id', this.sessionId);
      } else {
        // Session grants are deliberately tied to one app run. A restart is a
        // new session, so none of those grants may be reused.
        await this.store.expireSessionGrants(this.sessionId, now);
      }

      await this.store.expireGrants(now);
      // Pending promises do not survive a JS restart. Mark orphaned requests
      // expired so the dashboard never shows an unanswerable prompt.
      await this.store.expireOrphanedRequests(now);
      await this.store.expireStaleRequests(now);
      const stopped = (await this.store.getState('emergency_stop')) === '1';
      const reason = await this.store.getState('emergency_stop_reason');
      const stoppedAgents = parseStateList(await this.store.getState('stopped_agents'));
      const storedStopReport = parseStateJson<StopReport & { cancelled?: string[] }>(
        await this.store.getState('last_stop_report')
      );
      const lastStopReport: StopReport | null = storedStopReport
        ? {
            ...storedStopReport,
            stopRequested: storedStopReport.stopRequested ?? storedStopReport.cancelled ?? [],
          }
        : null;

      this.state = {
        ...this.state,
        emergencyStop: stopped,
        emergencyStopReason: reason,
        stoppedAgents,
        sessionId: this.sessionId,
        lastStopReport,
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

  /** Appends to the hash-linked activity journal and notifies chat subscribers. */
  async recordActivity(input: ActivityInput): Promise<void> {
    if (!this.activityStore) {
      return;
    }

    try {
      await this.activityStore.append(input);
      this.updateState({ activityRevision: this.state.activityRevision + 1 });
    } catch (error) {
      console.warn('Could not write the agent activity entry.', error);
    }
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
      resourceKey: action.resourceKey,
      fingerprint: action.fingerprint,
      freshConfirmation: action.freshConfirmation,
      reversible: action.reversible,
      external: action.external,
      allowAlways: action.allowAlways,
      status,
      resolution,
      createdAt: now,
      expiresAt: now + REQUEST_TTL_MS,
      resolvedAt: status === 'pending' ? null : now,
      metadata: {
        ...action.metadata,
        policyDecision: input.policy.decision,
        policyRuleId: input.policy.ruleId,
      },
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
      resourceKey: request.resourceKey,
      fingerprint: request.fingerprint,
      projectId: request.projectId,
      conversationId: request.conversationId,
      freshConfirmation: request.freshConfirmation,
      reversible: request.reversible,
      external: request.external,
      action: request.title,
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
            request.status === 'approved_session' ||
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
    const scope = {
      userId: input.userId,
      agentId: action.agent.id,
      toolName: action.toolName,
      category: action.category,
      projectId: action.projectId,
      scopeKey: action.scopeKey,
      resourceKey: action.resourceKey,
    };
    const activityBase = {
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      agentId: action.agent.id,
      agentName: action.agent.name,
      toolName: action.toolName,
      action: action.title,
      resourceKey: action.resourceKey,
      resourceLabel: action.target.label,
      category: action.category,
      risk: action.risk,
      reversible: action.reversible,
      external: action.external,
      metadata: {
        tool: action.toolName,
        target: action.target.label,
        fingerprint: action.fingerprint,
        freshConfirmation: action.freshConfirmation,
        consequences: action.consequences.join(' | '),
      },
    };

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
      await this.recordActivity({
        ...activityBase,
        status: 'blocked',
        error: 'Emergency stop is active.',
      });
      return denial(
        'emergency_stop',
        'Emergency stop is active. No agent actions can run until the user resumes permissions.'
      );
    }

    if (this.state.stoppedAgents.includes(action.agent.id)) {
      await this.audit({
        userId: input.userId,
        agentId: action.agent.id,
        event: 'execution_blocked',
        category: action.category,
        risk: action.risk,
        toolName: action.toolName,
        projectId: action.projectId,
        detail: `Blocked because ${action.agent.name} is stopped: ${action.title}`,
      });
      await this.recordActivity({
        ...activityBase,
        status: 'blocked',
        error: `${action.agent.name} is stopped.`,
      });
      return denial(
        'agent_stopped',
        `${action.agent.name} is stopped. Resume the agent before it can request another action.`
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
      await this.recordActivity({
        ...activityBase,
        status: 'denied',
        error: input.policy.reason ?? 'Blocked by policy.',
      });
      return denial(
        'policy_denied',
        `Blocked by policy: ${input.policy.reason ?? 'this action is not allowed.'}`
      );
    }

    const activeDenial = await this.store.findActiveDenial(scope);

    if (activeDenial) {
      await this.audit({
        userId: input.userId,
        agentId: action.agent.id,
        event: 'never_allowed',
        category: action.category,
        risk: action.risk,
        toolName: action.toolName,
        projectId: action.projectId,
        detail: `Blocked by a Never Allow decision for ${action.title}.`,
      });
      await this.recordActivity({
        ...activityBase,
        status: 'denied',
        error: 'You chose Never Allow for this exact action and resource.',
      });
      return denial(
        'never_allowed',
        'You chose Never Allow for this agent, tool, and resource. Revoke that decision in Tool Permissions to allow it again.'
      );
    }

    const askEveryTime = await this.store.findAskEveryTime(scope);
    const canReuseGrant =
      !action.freshConfirmation &&
      action.risk !== 'critical' &&
      input.policy.decision !== 'ask' &&
      !askEveryTime;

    if (canReuseGrant) {
      const existingGrant = await this.store.findMatchingGrant({
        ...scope,
        fingerprint: action.fingerprint,
        sessionId: this.sessionId,
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
          detail: `Reused a scoped ${existingGrant.scope} grant for ${action.agent.name}.`,
        });
        await this.recordActivity({
          ...activityBase,
          status: 'approved',
          permissionUsed: action.category,
          result: `Authorized by a saved ${existingGrant.scope} grant. Awaiting execution.`,
          requestId: request.id,
          grantId: existingGrant.id,
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
      !action.freshConfirmation &&
      !askEveryTime &&
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
      await this.recordActivity({
        ...activityBase,
        status: 'approved',
        permissionUsed: action.category,
        result: 'Auto-approved low-risk local action. Awaiting execution.',
        requestId: request.id,
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
    await this.recordActivity({
      ...activityBase,
      status: 'pending',
      permissionUsed: action.category,
      result: 'Waiting for your decision.',
      requestId: request.id,
    });

    return new Promise<PermissionOutcome>((resolve) => {
      const waiter: PendingWaiter = {
        request,
        resolve,
        timer: null,
        resolving: false,
        decisionToken: Symbol(),
      };
      this.pending.set(request.id, waiter);
      this.scheduleExpiry(waiter);
      this.refreshQueue();
    });
  }

  async resolveRequest(
    requestId: string,
    option: PermissionDecisionOption,
    userId?: number
  ): Promise<ResolveResult> {
    const ready = await this.ensureReady();
    let waiter = this.pending.get(requestId);

    if (!ready || !this.store || !waiter) {
      return { ok: false, message: 'This request is no longer pending.' };
    }

    const request = waiter.request;

    if (userId !== undefined && request.userId !== userId) {
      return { ok: false, message: 'This request belongs to another user.' };
    }

    if (!DECISION_OPTIONS.includes(option)) {
      return { ok: false, message: 'Unknown permission decision. Nothing was changed.' };
    }

    const claimed = this.claimPending(requestId);

    if (!claimed) {
      return { ok: false, message: 'This request is no longer pending.' };
    }

    waiter = claimed;

    if (option === 'deny') {
      const store = this.store;
      const resolvedAt = Date.now();
      const resolvedRequest: PermissionRequestRecord = {
        ...request,
        status: 'denied',
        resolution: 'deny',
        resolvedAt,
      };
      const persisted = await this.persistDecisionSteps(waiter, [
        () => store.updateRequestStatus(request.id, 'denied', 'deny', resolvedAt),
        () =>
          this.audit({
            userId: request.userId,
            requestId: request.id,
            agentId: request.agentId,
            event: 'denied',
            category: request.category,
            risk: request.risk,
            toolName: request.toolName,
            projectId: request.projectId,
            detail: `${request.agentName} was denied: ${request.title}`,
          }),
        () =>
          this.recordActivity({
            userId: request.userId,
            conversationId: request.conversationId,
            agentId: request.agentId,
            agentName: request.agentName,
            toolName: request.toolName,
            action: request.title,
            resourceKey: request.resourceKey,
            resourceLabel: request.target.label,
            permissionUsed: request.category,
            status: 'denied',
            error: 'You denied this action. Nothing was executed.',
            category: request.category,
            risk: request.risk,
            requestId: request.id,
            reversible: request.reversible,
            external: request.external,
          }),
      ]);

      if (!persisted) {
        return { ok: false, message: 'This request is no longer pending.' };
      }

      this.settle(request.id, resolvedRequest);
      waiter.resolve(
        denial('user_denied', `${request.agentName} was not given permission for this action.`, resolvedRequest)
      );
      return { ok: true };
    }

    if (option === 'never_allow') {
      const store = this.store;
      const resolvedAt = Date.now();
      const denialId = `denial_${Crypto.randomUUID()}`;
      const resolvedRequest: PermissionRequestRecord = {
        ...request,
        status: 'denied',
        resolution: 'never_allow',
        resolvedAt,
      };
      const persisted = await this.persistDecisionSteps(waiter, [
        () =>
          store.insertDenial({
            id: denialId,
            userId: request.userId,
            agentId: request.agentId,
            toolName: request.toolName,
            category: request.category,
            projectId: request.projectId,
            scopeKey: request.scopeKey,
            resourceKey: request.resourceKey,
            reason: 'never_allow',
            createdAt: resolvedAt,
            revokedAt: null,
          }),
        () => store.updateRequestStatus(request.id, 'denied', 'never_allow', resolvedAt),
        () =>
          this.audit({
            userId: request.userId,
            requestId: request.id,
            agentId: request.agentId,
            event: 'never_allowed',
            category: request.category,
            risk: request.risk,
            toolName: request.toolName,
            projectId: request.projectId,
            detail: `Never Allow saved for ${request.agentName} · ${request.toolName} · ${request.target.label}.`,
          }),
        () =>
          this.recordActivity({
            userId: request.userId,
            conversationId: request.conversationId,
            agentId: request.agentId,
            agentName: request.agentName,
            toolName: request.toolName,
            action: request.title,
            resourceKey: request.resourceKey,
            resourceLabel: request.target.label,
            permissionUsed: request.category,
            status: 'denied',
            error: 'Never Allow was saved. This exact action will be blocked until revoked.',
            category: request.category,
            risk: request.risk,
            requestId: request.id,
            reversible: request.reversible,
            external: request.external,
          }),
      ], async () => {
        await store.revokeDenial(request.userId, denialId, Date.now());
      });

      if (!persisted) {
        return { ok: false, message: 'This request is no longer pending.' };
      }

      this.settle(request.id, resolvedRequest);
      waiter.resolve(
        denial(
          'never_allowed',
          'Never Allow was saved. This exact action will be blocked until you revoke that decision.',
          resolvedRequest
        )
      );
      return { ok: true };
    }

    if (option === 'ask_every_time') {
      const store = this.store;
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
        resourceKey: request.resourceKey,
        fingerprint: request.fingerprint,
        projectId: request.projectId,
        projectLabel: request.projectLabel,
        scope: 'once',
        sessionId: '',
        choice: 'one_time',
        narrow: false,
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
      const resolvedRequest: PermissionRequestRecord = {
        ...request,
        status: 'approved_once',
        resolution: 'ask_every_time',
        resolvedAt: now,
      };
      const persisted = await this.persistDecisionSteps(waiter, [
        () =>
          store.setAskEveryTime({
            userId: request.userId,
            agentId: request.agentId,
            toolName: request.toolName,
            category: request.category,
            projectId: request.projectId,
            scopeKey: request.scopeKey,
            resourceKey: request.resourceKey,
            choice: 'ask_every_time',
            createdAt: now,
            updatedAt: now,
            revokedAt: null,
          }),
        () => store.insertGrant(grant),
        () => store.updateRequestStatus(request.id, 'approved_once', 'ask_every_time', now),
        () =>
          this.audit({
            userId: request.userId,
            requestId: request.id,
            grantId: grant.id,
            agentId: request.agentId,
            event: 'ask_every_time',
            category: request.category,
            risk: request.risk,
            toolName: request.toolName,
            projectId: request.projectId,
            detail: `Ask Every Time saved for ${request.agentName} · ${request.toolName}. This action was approved once.`,
          }),
        () =>
          this.recordActivity({
            userId: request.userId,
            conversationId: request.conversationId,
            agentId: request.agentId,
            agentName: request.agentName,
            toolName: request.toolName,
            action: request.title,
            resourceKey: request.resourceKey,
            resourceLabel: request.target.label,
            permissionUsed: request.category,
            status: 'approved',
            result: 'Approved for this one execution. Awaiting execution. You will be asked again next time.',
            category: request.category,
            risk: request.risk,
            requestId: request.id,
            grantId: grant.id,
            reversible: request.reversible,
            external: request.external,
          }),
      ], async () => {
        await store.revokeGrant(grant.id, request.userId, Date.now());
        await store.revokePreference(request.userId, request, Date.now());
      });

      if (!persisted) {
        return { ok: false, message: 'This request is no longer pending.' };
      }

      this.settle(request.id, resolvedRequest);
      waiter.resolve({
        allowed: true,
        authorization: this.issueAuthorization(resolvedRequest, grant),
        request: resolvedRequest,
        via: 'allow_once',
      });
      return { ok: true };
    }

    if (option === 'always_allow' || option === 'allow_session') {
      const store = this.store;
      const isSaved = option === 'always_allow';
      const policyDecision = request.metadata.policyDecision;

      if (
        request.risk === 'high' ||
        request.risk === 'critical' ||
        request.freshConfirmation ||
        !request.allowAlways ||
        policyDecision === 'ask'
      ) {
        this.releasePending(waiter);
        return {
          ok: false,
          message:
            'This action needs fresh confirmation every time. Only Allow Once, Ask Every Time, or Deny can be used.',
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
        resourceKey: request.resourceKey,
        fingerprint: request.fingerprint,
        projectId: request.projectId,
        projectLabel: request.projectLabel,
        scope: isSaved ? 'persistent' : 'session',
        sessionId: isSaved ? '' : this.sessionId,
        choice: isSaved ? 'always_allow' : 'allow_session',
        narrow: true,
        risk: request.risk,
        title: request.title,
        createdAt: now,
        expiresAt: now + (isSaved ? PERSISTENT_GRANT_TTL_MS : SESSION_GRANT_TTL_MS),
        lastUsedAt: null,
        useCount: 0,
        maxUses: null,
        revokedAt: null,
        status: 'active',
      };
      const status: PermissionRequestRecord['status'] = isSaved
        ? 'approved_always'
        : 'approved_session';
      const resolution: PermissionResolution = isSaved ? 'always_allow' : 'allow_session';
      const resolvedRequest: PermissionRequestRecord = {
        ...request,
        status,
        resolution,
        resolvedAt: now,
      };
      const persisted = await this.persistDecisionSteps(waiter, [
        () => store.insertGrant(grant),
        () => store.updateRequestStatus(request.id, status, resolution, now),
        () =>
          this.audit({
            userId: request.userId,
            requestId: request.id,
            grantId: grant.id,
            agentId: request.agentId,
            event: isSaved ? 'approved_always' : 'approved_session',
            category: request.category,
            risk: request.risk,
            toolName: request.toolName,
            projectId: request.projectId,
            detail: isSaved
              ? `Saved a narrow grant for ${request.agentName} · ${request.toolName} · ${request.target.label}.`
              : `Saved a session-only grant for ${request.agentName} · ${request.toolName} · ${request.target.label}.`,
          }),
        () =>
          this.recordActivity({
            userId: request.userId,
            conversationId: request.conversationId,
            agentId: request.agentId,
            agentName: request.agentName,
            toolName: request.toolName,
            action: request.title,
            resourceKey: request.resourceKey,
            resourceLabel: request.target.label,
            permissionUsed: request.category,
            status: 'approved',
            result: isSaved
              ? 'Approved and saved for this exact action and resource. Awaiting execution. Revoke it any time.'
              : 'Approved for this app session only. Awaiting execution.',
            category: request.category,
            risk: request.risk,
            requestId: request.id,
            grantId: grant.id,
            reversible: request.reversible,
            external: request.external,
          }),
      ], async () => {
        await store.revokeGrant(grant.id, request.userId, Date.now());
      });

      if (!persisted) {
        return { ok: false, message: 'This request is no longer pending.' };
      }

      this.settle(request.id, resolvedRequest);
      waiter.resolve({
        allowed: true,
        authorization: this.issueAuthorization(resolvedRequest, grant),
        request: resolvedRequest,
        via: isSaved ? 'always_allow' : 'allow_session',
      });
      return { ok: true };
    }

    const store = this.store;
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
      resourceKey: request.resourceKey,
      fingerprint: request.fingerprint,
      projectId: request.projectId,
      projectLabel: request.projectLabel,
      scope: 'once',
      sessionId: '',
      choice: 'one_time',
      narrow: false,
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
    const resolvedRequest: PermissionRequestRecord = {
      ...request,
      status: 'approved_once',
      resolution: 'allow_once',
      resolvedAt: now,
    };
    const persisted = await this.persistDecisionSteps(waiter, [
      () => store.insertGrant(grant),
      () => store.updateRequestStatus(request.id, 'approved_once', 'allow_once', now),
      () =>
        this.audit({
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
        }),
      () =>
        this.recordActivity({
          userId: request.userId,
          conversationId: request.conversationId,
          agentId: request.agentId,
          agentName: request.agentName,
          toolName: request.toolName,
          action: request.title,
          resourceKey: request.resourceKey,
          resourceLabel: request.target.label,
          permissionUsed: request.category,
          status: 'approved',
          result: 'Approved for this one execution only. Awaiting execution.',
          category: request.category,
          risk: request.risk,
          requestId: request.id,
          grantId: grant.id,
          reversible: request.reversible,
          external: request.external,
        }),
    ], async () => {
      await store.revokeGrant(grant.id, request.userId, Date.now());
    });

    if (!persisted) {
      return { ok: false, message: 'This request is no longer pending.' };
    }

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
    let waiter = this.pending.get(requestId);

    if (!ready || !this.store || !waiter) {
      return { ok: false, message: 'This request is no longer pending.' };
    }

    const request = waiter.request;

    if (userId !== undefined && request.userId !== userId) {
      return { ok: false, message: 'This request belongs to another user.' };
    }

    const claimed = this.claimPending(requestId);

    if (!claimed) {
      return { ok: false, message: 'This request is no longer pending.' };
    }

    waiter = claimed;
    const store = this.store;
    const resolvedAt = Date.now();
    const resolvedRequest: PermissionRequestRecord = {
      ...request,
      status: 'cancelled',
      resolution: 'cancel',
      resolvedAt,
    };
    const persisted = await this.persistDecisionSteps(waiter, [
      () => store.updateRequestStatus(request.id, 'cancelled', 'cancel', resolvedAt),
      () =>
        this.audit({
          userId: request.userId,
          requestId: request.id,
          agentId: request.agentId,
          event: 'cancelled',
          category: request.category,
          risk: request.risk,
          toolName: request.toolName,
          projectId: request.projectId,
          detail: `The user cancelled ${request.agentName}’s pending request.`,
        }),
    ]);

    if (!persisted) {
      return { ok: false, message: 'This request is no longer pending.' };
    }

    this.settle(request.id, resolvedRequest);
    waiter.resolve(
      denial('user_cancelled', 'The user cancelled this permission request.', resolvedRequest)
    );
    return { ok: true };
  }

  private scheduleExpiry(waiter: PendingWaiter): void {
    if (waiter.timer) {
      clearTimeout(waiter.timer);
    }

    const remaining = Math.max(0, waiter.request.createdAt + REQUEST_TTL_MS - Date.now());
    waiter.timer = setTimeout(() => {
      this.expirePending(waiter.request.id);
    }, remaining);
  }

  /** Disables expiry while a decision is being persisted. */
  private claimPending(requestId: string, force = false): PendingWaiter | null {
    const waiter = this.pending.get(requestId);

    if (!waiter || (waiter.resolving && !force)) {
      return null;
    }

    if (waiter.timer) {
      clearTimeout(waiter.timer);
      waiter.timer = null;
    }

    if (force) {
      waiter.decisionToken = Symbol();
    }

    waiter.resolving = true;
    return waiter;
  }

  private isCurrentPending(waiter: PendingWaiter, token = waiter.decisionToken): boolean {
    return this.pending.get(waiter.request.id) === waiter && waiter.decisionToken === token;
  }

  /**
   * Writes a decision one step at a time. If a stop or cancellation removes the
   * pending waiter mid-decision, no later grant, audit, or activity is written.
   */
  private async persistDecisionSteps(
    waiter: PendingWaiter,
    steps: (() => Promise<void>)[],
    rollback?: () => Promise<void>
  ): Promise<boolean> {
    const token = waiter.decisionToken;
    const isCurrent = (): boolean => this.isCurrentPending(waiter, token);
    const undo = async (): Promise<void> => {
      if (!rollback) {
        return;
      }

      try {
        await rollback();
      } catch (error) {
        console.warn('Could not roll back a cancelled permission decision.', error);
      }
    };

    for (const step of steps) {
      if (!isCurrent()) {
        await undo();
        return false;
      }

      try {
        await step();
      } catch (error) {
        if (isCurrent()) {
          this.releasePending(waiter);
        }
        throw error;
      }
    }

    if (!isCurrent()) {
      await undo();
      return false;
    }

    return true;
  }

  /** Restores expiry when a decision was rejected without settling the request. */
  private releasePending(waiter: PendingWaiter): void {
    if (!this.isCurrentPending(waiter)) {
      return;
    }

    waiter.resolving = false;
    this.scheduleExpiry(waiter);
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

    if (!waiter || waiter.resolving || !this.store) {
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
    expected: {
      agentId: string;
      toolName: string;
      category: PermissionCategory;
      scopeKey: string;
      resourceKey: string;
      fingerprint: string;
      freshConfirmation: boolean;
      external: boolean;
      reversible: boolean;
    }
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

    if (this.state.stoppedAgents.includes(authorization.agentId)) {
      await this.audit({
        userId: authorization.userId,
        requestId: authorization.requestId,
        agentId: authorization.agentId,
        event: 'execution_blocked',
        category: authorization.category,
        risk: authorization.risk,
        toolName: authorization.toolName,
        projectId: authorization.projectId,
        detail: 'Execution blocked because the agent is stopped.',
      });
      return {
        ok: false,
        reason: 'agent_stopped',
        message: 'This agent is stopped. Execution was blocked.',
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
      authorization.category !== expected.category ||
      authorization.scopeKey !== expected.scopeKey ||
      authorization.resourceKey !== expected.resourceKey ||
      authorization.fingerprint !== expected.fingerprint ||
      authorization.freshConfirmation !== expected.freshConfirmation ||
      authorization.external !== expected.external ||
      authorization.reversible !== expected.reversible
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
        message: 'The approval does not match this exact agent, tool, resource, and action.',
      };
    }

    const request = await this.store.getRequest(authorization.requestId);

    if (
      !request ||
      request.userId !== authorization.userId ||
      !['approved_once', 'approved_session', 'approved_always', 'auto_approved'].includes(
        request.status
      )
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
        grant.resourceKey !== authorization.resourceKey ||
        grant.fingerprint !== authorization.fingerprint ||
        grant.projectId !== authorization.projectId ||
        (grant.scope !== 'once' && !grant.narrow) ||
        (grant.scope !== 'once' && grant.risk === 'critical') ||
        (grant.scope === 'session' && grant.sessionId !== this.sessionId) ||
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
    error?: string,
    detail?: string
  ): Promise<void> {
    if (!this.store) {
      return;
    }

    const status = success ? 'completed' : 'failed';
    const suffix = detail ? ` ${detail}` : '';
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
        ? `Execution completed for ${authorization.toolName}.${suffix}`
        : `Execution failed for ${authorization.toolName}: ${error ?? 'unknown error'}.${suffix}`,
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

  /** Starts a cancellable execution handle owned by the permission service. */
  startOperation(input: {
    userId: number;
    conversationId?: number | null;
    agentId: string;
    agentName: string;
    toolName: string;
    detail: string;
    cancellable: boolean;
    external: boolean;
  }): { id: string; signal: AbortSignal } {
    const id = `op_${Crypto.randomUUID()}`;
    const controller = new AbortController();
    const operation: ActiveOperation = {
      id,
      userId: input.userId,
      conversationId: input.conversationId ?? null,
      agentId: input.agentId,
      agentName: input.agentName,
      toolName: input.toolName,
      status: 'running',
      cancellable: input.cancellable,
      external: input.external,
      startedAt: Date.now(),
      finishedAt: null,
      detail: input.detail,
    };
    this.operations.set(id, { controller, operation });
    void this.safetyStore?.insertOperation(operation).catch((error) => {
      console.warn('Could not record the active operation.', error);
    });
    return { id, signal: controller.signal };
  }

  /** Requests cancellation of one running operation from the dashboard. */
  async cancelOperation(
    userId: number,
    id: string,
    reason = 'You stopped this operation.'
  ): Promise<OperationStopResult> {
    const entry = this.operations.get(id);

    if (!entry || entry.operation.userId !== userId) {
      return {
        handled: false,
        state: 'not_running',
        message: 'This operation is no longer running.',
      };
    }

    const operation = entry.operation;
    const state: OperationStopState = operation.cancellable
      ? operation.external
        ? 'external_stop_requested'
        : 'stop_requested'
      : operation.external
        ? 'external_unconfirmed'
        : 'unconfirmed';

    if (operation.cancellable) {
      entry.controller.abort();
      await this.safetyStore?.updateOperationStatus(
        userId,
        id,
        'cancelling',
        reason,
        Date.now()
      );
    } else {
      const detail = operation.external
        ? `${reason} The external service may have completed.`
        : `${reason} The operation had already become uncancellable.`;
      await this.finishOperation(userId, id, 'unknown', detail);
    }

    await this.audit({
      userId,
      requestId: null,
      agentId: operation.agentId,
      event: 'execution_blocked',
      toolName: operation.toolName,
      detail: reason,
    });
    await this.recordActivity({
      userId,
      conversationId: operation.conversationId,
      agentId: operation.agentId,
      agentName: operation.agentName,
      toolName: operation.toolName,
      action: operation.detail,
      status: operation.external ? 'unknown' : operation.cancellable ? 'stopped' : 'unknown',
      error: operation.external
        ? `${reason} The result is unconfirmed; check the external service.`
        : operation.cancellable
          ? `${reason} Cancellation was requested; waiting for the tool to confirm.`
          : `${reason} The operation was uncancellable.`,
      external: operation.external,
      metadata: { operationId: id, stopState: state },
    });

    const message =
      state === 'external_stop_requested'
        ? 'Stop requested. The external service may already have completed; check it before retrying.'
        : state === 'external_unconfirmed'
          ? 'Stop requested, but the operation was uncancellable and the external result may persist.'
          : state === 'stop_requested'
            ? 'Cancellation signal sent. Waiting for the tool to confirm that it stopped.'
            : 'Stop requested, but the operation was uncancellable. Its result is unconfirmed.';

    return { handled: true, state, message };
  }

  async finishOperation(
    userId: number,
    id: string,
    status: ActiveOperation['status'],
    detail: string
  ): Promise<void> {
    const entry = this.operations.get(id);
    const finishedAt = Date.now();
    const finalStatus = status === 'stopped' && entry?.operation.external ? 'unknown' : status;

    if (entry) {
      this.operations.delete(id);
    }

    if (this.safetyStore) {
      try {
        await this.safetyStore.updateOperationStatus(userId, id, finalStatus, detail, finishedAt);
      } catch (error) {
        console.warn('Could not update the active operation.', error);
      }
    }
  }

  private cancelOperations(
    predicate: (operation: ActiveOperation) => boolean
  ): StopReport {
    const report: StopReport = {
      stopRequested: [],
      uncancellable: [],
      revokedGrants: 0,
      cancelledRequests: 0,
      createdAt: Date.now(),
    };

    for (const [id, entry] of this.operations) {
      if (!predicate(entry.operation)) {
        continue;
      }

      if (entry.operation.cancellable) {
        entry.controller.abort();
        report.stopRequested.push(
          entry.operation.external
            ? `${entry.operation.agentName} · ${entry.operation.toolName} (stop requested; external service may have completed)`
            : `${entry.operation.agentName} · ${entry.operation.toolName}`
        );
        void this.finishOperation(
          entry.operation.userId,
          id,
          'stopped',
          'Stop requested; the cancellable operation was aborted.'
        );
      } else {
        const label = entry.operation.external
          ? `${entry.operation.agentName} · ${entry.operation.toolName} (external service may have completed)`
          : `${entry.operation.agentName} · ${entry.operation.toolName}`;
        report.uncancellable.push(label);
        void this.finishOperation(
          entry.operation.userId,
          id,
          'unknown',
          entry.operation.external
            ? 'Stop requested; the external operation may have completed. Check the external service.'
            : 'Stop requested after the operation became uncancellable.'
        );
      }
    }

    return report;
  }

  private async cancelPendingRequests(
    reason: 'emergency_stop' | 'agent_stopped',
    predicate: (request: PermissionRequestRecord) => boolean,
    message: string
  ): Promise<number> {
    const pending = Array.from(this.pending.values()).filter((waiter) => predicate(waiter.request));
    const now = Date.now();
    let cancelled = 0;

    for (const candidate of pending) {
      const waiter = this.claimPending(candidate.request.id, true);

      if (!waiter) {
        continue;
      }

      const request = waiter.request;
      const resolvedRequest: PermissionRequestRecord = {
        ...request,
        status: 'cancelled',
        resolution: reason,
        resolvedAt: now,
      };
      const persisted = await this.persistDecisionSteps(waiter, [
        async () => {
          await this.store?.updateRequestStatus(request.id, 'cancelled', reason, now);
        },
        () =>
          this.audit({
            userId: request.userId,
            requestId: request.id,
            agentId: request.agentId,
            event: 'cancelled',
            category: request.category,
            risk: request.risk,
            toolName: request.toolName,
            projectId: request.projectId,
            detail: message,
          }),
        () =>
          this.recordActivity({
            userId: request.userId,
            conversationId: request.conversationId,
            agentId: request.agentId,
            agentName: request.agentName,
            toolName: request.toolName,
            action: request.title,
            resourceKey: request.resourceKey,
            resourceLabel: request.target.label,
            permissionUsed: request.category,
            status: 'stopped',
            error: message,
            category: request.category,
            risk: request.risk,
            requestId: request.id,
            reversible: request.reversible,
            external: request.external,
          }),
      ]);

      if (!persisted) {
        continue;
      }

      this.settle(request.id, resolvedRequest);
      waiter.resolve(
        denial(reason === 'emergency_stop' ? 'emergency_stop' : 'agent_stopped', message, resolvedRequest)
      );
      cancelled += 1;
    }

    return cancelled;
  }

  async emergencyStop(userId: number, reason = 'User stopped all agent execution'): Promise<void> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return;
    }

    const report = this.cancelOperations((operation) => operation.userId === userId);
    report.cancelledRequests = await this.cancelPendingRequests(
      'emergency_stop',
      (request) => request.userId === userId,
      'Emergency stop cancelled this pending request before execution.'
    );
    report.revokedGrants = await this.store.revokeAllGrants(userId, Date.now());
    report.reason = reason;
    report.agentId = null;

    await this.store.setState('emergency_stop', '1');
    await this.store.setState('emergency_stop_reason', reason);
    await this.store.setState('last_stop_report', JSON.stringify(report));
    this.invalidateAllAuthorizations();
    this.updateState({
      emergencyStop: true,
      emergencyStopReason: reason,
      lastStopReport: report,
    });
    await this.audit({
      userId,
      event: 'emergency_stop',
      detail: `${reason}. Stop requested for ${report.stopRequested.length} operation(s); ${report.uncancellable.length} could not be cancelled; revoked ${report.revokedGrants} saved permission(s).`,
    });
    await this.recordActivity({
      userId,
      agentId: 'system',
      agentName: 'ORBIT safety',
      toolName: 'emergency_stop',
      action: 'Emergency stop',
      status: 'stopped',
      result: `Stop requested for ${report.stopRequested.length} operation(s), blocked ${report.uncancellable.length} uncancellable operation(s), revoked ${report.revokedGrants} saved permission(s).`,
      metadata: {
        reason,
        stopRequested: report.stopRequested.join(' | '),
        uncancellable: report.uncancellable.join(' | '),
        revokedGrants: report.revokedGrants,
        cancelledRequests: report.cancelledRequests,
      },
    });
  }

  /** Stops one agent immediately without pausing unrelated agents. */
  async stopAgent(userId: number, agentId: string, reason = 'User stopped this agent'): Promise<StopReport> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return { stopRequested: [], uncancellable: [], revokedGrants: 0, cancelledRequests: 0 };
    }

    const report = this.cancelOperations(
      (operation) => operation.userId === userId && operation.agentId === agentId
    );
    report.cancelledRequests = await this.cancelPendingRequests(
      'agent_stopped',
      (request) => request.userId === userId && request.agentId === agentId,
      `${agentId} was stopped before this request was answered.`
    );
    report.revokedGrants = await this.store.revokeAgentGrants(userId, agentId, Date.now());
    report.reason = reason;
    report.agentId = agentId;

    const stoppedAgents = Array.from(new Set([...this.state.stoppedAgents, agentId]));
    await this.store.setState('stopped_agents', JSON.stringify(stoppedAgents));
    await this.store.setState('last_stop_report', JSON.stringify(report));
    this.invalidateAuthorizationsForAgent(agentId);
    this.updateState({ stoppedAgents, lastStopReport: report });
    await this.audit({
      userId,
      agentId,
      event: 'agent_stopped',
      detail: `${reason}. Stop requested for ${report.stopRequested.length} operation(s); ${report.uncancellable.length} could not be cancelled; revoked ${report.revokedGrants} saved permission(s).`,
    });
    await this.recordActivity({
      userId,
      agentId,
      agentName: agentId,
      toolName: 'stop_agent',
      action: 'Stop agent',
      status: 'stopped',
      result: `Stop requested for ${agentId}; revoked ${report.revokedGrants} saved permission(s).`,
      metadata: {
        reason,
        stopRequested: report.stopRequested.join(' | '),
        uncancellable: report.uncancellable.join(' | '),
        revokedGrants: report.revokedGrants,
        cancelledRequests: report.cancelledRequests,
      },
    });
    return report;
  }

  async resumeAgent(userId: number, agentId: string): Promise<void> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return;
    }

    const stoppedAgents = this.state.stoppedAgents.filter((entry) => entry !== agentId);
    await this.store.setState('stopped_agents', JSON.stringify(stoppedAgents));
    this.updateState({ stoppedAgents });
    await this.audit({
      userId,
      agentId,
      event: 'agent_resumed',
      detail: 'The user resumed this agent.',
    });
  }

  async resumePermissions(userId: number): Promise<void> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return;
    }

    await this.store.setState('emergency_stop', '0');
    await this.store.setState('emergency_stop_reason', '');
    await this.store.setState('stopped_agents', '[]');
    this.updateState({
      emergencyStop: false,
      emergencyStopReason: null,
      stoppedAgents: [],
    });
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
    const report = this.cancelOperations(
      (operation) => operation.userId === userId && operation.agentId === agentId
    );
    this.invalidateAuthorizationsForAgent(agentId);
    await this.audit({
      userId,
      agentId,
      event: 'grant_revoked',
      detail: `Revoked ${count} saved permission${count === 1 ? '' : 's'} and requested stop for ${report.stopRequested.length} active operation(s); ${report.uncancellable.length} could not be cancelled.`,
    });
    return count;
  }

  async revokeAllGrants(userId: number): Promise<number> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return 0;
    }

    const count = await this.store.revokeAllGrants(userId, Date.now());
    const report = this.cancelOperations((operation) => operation.userId === userId);
    this.invalidateAllAuthorizations();
    await this.audit({
      userId,
      event: 'grant_revoked',
      detail: `Revoked all ${count} saved permissions and requested stop for ${report.stopRequested.length} active operation(s); ${report.uncancellable.length} could not be cancelled.`,
    });
    return count;
  }

  async revokeSessionGrants(userId: number): Promise<number> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return 0;
    }

    const count = await this.store.revokeSessionGrants(userId, Date.now());
    if (count > 0) {
      this.invalidateAllAuthorizations();
      await this.audit({
        userId,
        event: 'grant_revoked',
        detail: `Revoked ${count} session-only permission(s).`,
      });
    }
    return count;
  }

  async revokeDenial(userId: number, denialId: string): Promise<boolean> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return false;
    }

    const revoked = await this.store.revokeDenial(userId, denialId, Date.now());
    if (revoked) {
      await this.audit({
        userId,
        event: 'grant_revoked',
        detail: 'Revoked a Never Allow decision. The exact action can be requested again.',
      });
    }
    return revoked;
  }

  async revokePreference(
    userId: number,
    input: Pick<
      PermissionPreferenceRecord,
      'agentId' | 'toolName' | 'category' | 'projectId' | 'scopeKey' | 'resourceKey'
    >
  ): Promise<boolean> {
    const ready = await this.ensureReady();

    if (!ready || !this.store) {
      return false;
    }

    const revoked = await this.store.revokePreference(userId, input, Date.now());
    if (revoked) {
      await this.audit({
        userId,
        agentId: input.agentId,
        event: 'grant_revoked',
        category: input.category,
        toolName: input.toolName,
        projectId: input.projectId,
        detail: 'Revoked an Ask Every Time preference.',
      });
    }
    return revoked;
  }

  getStopReport(): StopReport | null {
    return this.state.lastStopReport;
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
        denials: [],
        preferences: [],
        activeOperations: [],
        activity: [],
        stoppedAgents: this.state.stoppedAgents,
        sessionId: this.sessionId,
        emergencyStop: this.state.emergencyStop,
        emergencyStopReason: this.state.emergencyStopReason,
        pending: [],
      };
    }

    const now = Date.now();
    await this.store.expireGrants(now);
    await this.store.expireStaleRequests(now);
    const [grants, requests, audit, devices, dynamicAgents, denials, preferences, activity, activeOperations] =
      await Promise.all([
        this.store.listGrants(userId),
        this.store.listRequests(userId),
        this.store.listAudit(userId),
        this.store.listDevices(userId),
        listDynamicAgents(this.db, userId),
        this.store.listDenials(userId),
        this.store.listPreferences(userId),
        this.activityStore?.list(userId, 60) ?? Promise.resolve([]),
        this.safetyStore?.listOperations(userId, 30) ?? Promise.resolve([]),
      ]);

    return {
      grants,
      requests,
      audit,
      devices,
      dynamicAgents,
      denials,
      preferences,
      activity,
      activeOperations,
      stoppedAgents: this.state.stoppedAgents,
      sessionId: this.sessionId,
      emergencyStop: this.state.emergencyStop,
      emergencyStopReason: this.state.emergencyStopReason,
      pending: Array.from(this.pending.values())
        .map((waiter) => waiter.request)
        .filter((request) => request.userId === userId),
    };
  }

  async getActivity(
    userId: number,
    conversationId?: number | null,
    limit = 40
  ): Promise<ActivityRecord[]> {
    if (!this.activityStore) {
      return [];
    }

    return conversationId
      ? this.activityStore.listForConversation(userId, conversationId, limit)
      : this.activityStore.list(userId, limit);
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
