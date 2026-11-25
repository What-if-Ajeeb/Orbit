import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SQLiteDatabase } from 'expo-sqlite';

import { classifyToolAction } from './classifier';
import { PermissionManager } from './manager';
import type {
  AgentIdentity,
  ClassifiedPermissionAction,
  PermissionAuditRecord,
  PermissionDecisionOption,
  PermissionDenialRecord,
  PermissionGrantRecord,
  PermissionPreferenceRecord,
  PermissionRequestRecord,
  PermissionRequestStatus,
  PermissionResolution,
} from './types';

const uuid = vi.hoisted(() => ({ value: 0 }));
vi.mock('expo-crypto', () => ({
  randomUUID: () => `uuid-${++uuid.value}`,
}));

const AGENT: AgentIdentity = {
  id: 'developer',
  name: 'Developer Agent',
  role: 'specialist',
  description: 'Writes code',
  icon: 'code-slash',
};

function action(toolName: string, args: Record<string, unknown>): ClassifiedPermissionAction {
  return classifyToolAction({
    toolName,
    args,
    agent: AGENT,
    projectId: 'project-1',
    projectLabel: 'Orbit',
  });
}

function matchesScope(
  input: {
    userId: number;
    agentId: string;
    toolName: string;
    category: string;
    projectId: string;
    scopeKey: string;
    resourceKey: string;
  },
  entry: {
    userId: number;
    agentId: string;
    toolName: string;
    category: string;
    projectId: string;
    scopeKey: string;
    resourceKey: string;
  }
): boolean {
  return (
    input.userId === entry.userId &&
    input.agentId === entry.agentId &&
    input.toolName === entry.toolName &&
    input.category === entry.category &&
    input.projectId === entry.projectId &&
    input.scopeKey === entry.scopeKey &&
    input.resourceKey === entry.resourceKey
  );
}

/** Minimal persistence double so decisions are tested without a device database. */
class FakePermissionStore {
  requests = new Map<string, PermissionRequestRecord>();
  grants = new Map<string, PermissionGrantRecord>();
  denials = new Map<string, PermissionDenialRecord>();
  preferences = new Map<string, PermissionPreferenceRecord>();
  audits: PermissionAuditRecord[] = [];
  state = new Map<string, string>();

  async getState(key: string): Promise<string | null> {
    return this.state.get(key) ?? null;
  }

  async setState(key: string, value: string): Promise<void> {
    this.state.set(key, value);
  }

  async expireSessionGrants(sessionId: string, now: number): Promise<void> {
    for (const grant of this.grants.values()) {
      if (grant.scope === 'session' && grant.sessionId !== sessionId && grant.status === 'active') {
        grant.status = 'expired';
        grant.revokedAt = now;
      }
    }
  }

  async expireGrants(now: number): Promise<void> {
    for (const grant of this.grants.values()) {
      if (grant.status === 'active' && grant.expiresAt !== null && grant.expiresAt <= now) {
        grant.status = 'expired';
      }
    }
  }

  async expireOrphanedRequests(): Promise<void> {}
  async expireStaleRequests(): Promise<void> {}

  async insertRequest(request: PermissionRequestRecord): Promise<void> {
    this.requests.set(request.id, { ...request });
  }

  async getRequest(id: string): Promise<PermissionRequestRecord | null> {
    return this.requests.get(id) ?? null;
  }

  async updateRequestStatus(
    id: string,
    status: PermissionRequestStatus,
    resolution: PermissionResolution | null = null,
    resolvedAt?: number
  ): Promise<void> {
    const request = this.requests.get(id);

    if (request) {
      request.status = status;
      if (resolution !== null) {
        request.resolution = resolution;
      }
      if (resolvedAt !== undefined) {
        request.resolvedAt = resolvedAt;
      }
    }
  }

  async addAudit(record: PermissionAuditRecord): Promise<void> {
    this.audits.push(record);
  }

  async findActiveDenial(input: {
    userId: number;
    agentId: string;
    toolName: string;
    category: PermissionDenialRecord['category'];
    projectId: string;
    scopeKey: string;
    resourceKey: string;
  }): Promise<PermissionDenialRecord | null> {
    return (
      Array.from(this.denials.values()).find(
        (denial) => denial.revokedAt === null && matchesScope(input, denial)
      ) ?? null
    );
  }

  async findAskEveryTime(input: {
    userId: number;
    agentId: string;
    toolName: string;
    category: PermissionPreferenceRecord['category'];
    projectId: string;
    scopeKey: string;
    resourceKey: string;
  }): Promise<PermissionPreferenceRecord | null> {
    return (
      Array.from(this.preferences.values()).find(
        (entry) =>
          entry.revokedAt === null &&
          entry.choice === 'ask_every_time' &&
          matchesScope(input, entry)
      ) ?? null
    );
  }

  async findMatchingGrant(input: {
    userId: number;
    agentId: string;
    toolName: string;
    category: PermissionGrantRecord['category'];
    projectId: string;
    scopeKey: string;
    resourceKey: string;
    fingerprint: string;
    sessionId: string;
    now: number;
  }): Promise<PermissionGrantRecord | null> {
    return (
      Array.from(this.grants.values()).find((grant) => {
        return (
          grant.status === 'active' &&
          grant.revokedAt === null &&
          grant.narrow &&
          grant.risk !== 'high' &&
          grant.risk !== 'critical' &&
          (grant.expiresAt === null || grant.expiresAt > input.now) &&
          (grant.maxUses === null || grant.useCount < grant.maxUses) &&
          (grant.scope === 'persistent' ||
            (grant.scope === 'session' && grant.sessionId === input.sessionId)) &&
          grant.fingerprint === input.fingerprint &&
          matchesScope(input, grant)
        );
      }) ?? null
    );
  }

  async insertGrant(grant: PermissionGrantRecord): Promise<void> {
    this.grants.set(grant.id, { ...grant });
  }

  async getGrant(id: string): Promise<PermissionGrantRecord | null> {
    return this.grants.get(id) ?? null;
  }

  async markGrantUsed(id: string, now: number, consume: boolean): Promise<void> {
    const grant = this.grants.get(id);

    if (grant) {
      grant.useCount += 1;
      grant.lastUsedAt = now;
      if (consume) {
        grant.status = 'consumed';
      }
    }
  }

  async insertDenial(denial: PermissionDenialRecord): Promise<void> {
    this.denials.set(denial.id, { ...denial });
  }

  async revokeDenial(userId: number, id: string, now: number): Promise<boolean> {
    const denial = this.denials.get(id);

    if (!denial || denial.userId !== userId || denial.revokedAt !== null) {
      return false;
    }

    denial.revokedAt = now;
    return true;
  }

  async setAskEveryTime(preference: PermissionPreferenceRecord): Promise<void> {
    this.preferences.set(this.preferenceKey(preference), { ...preference });
  }

  private preferenceKey(
    preference: Pick<
      PermissionPreferenceRecord,
      'userId' | 'agentId' | 'toolName' | 'scopeKey' | 'resourceKey'
    >
  ): string {
    return `${preference.userId}:${preference.agentId}:${preference.toolName}:${preference.scopeKey}:${preference.resourceKey}`;
  }

  async revokePreference(
    userId: number,
    input: Pick<
      PermissionPreferenceRecord,
      'agentId' | 'toolName' | 'category' | 'projectId' | 'scopeKey' | 'resourceKey'
    >,
    now: number
  ): Promise<boolean> {
    const key = this.preferenceKey({ userId, ...input });
    const preference = this.preferences.get(key);

    if (!preference || preference.revokedAt !== null) {
      return false;
    }

    preference.revokedAt = now;
    return true;
  }

  async revokeGrant(id: string, userId: number, now: number): Promise<boolean> {
    const grant = this.grants.get(id);

    if (!grant || grant.userId !== userId || grant.status === 'revoked') {
      return false;
    }

    grant.status = 'revoked';
    grant.revokedAt = now;
    return true;
  }

  async revokeAgentGrants(userId: number, agentId: string, now: number): Promise<number> {
    let count = 0;
    for (const grant of this.grants.values()) {
      if (grant.userId === userId && grant.agentId === agentId && grant.status === 'active') {
        grant.status = 'revoked';
        grant.revokedAt = now;
        count += 1;
      }
    }
    return count;
  }

  async revokeAllGrants(userId: number, now: number): Promise<number> {
    let count = 0;
    for (const grant of this.grants.values()) {
      if (grant.userId === userId && grant.status === 'active') {
        grant.status = 'revoked';
        grant.revokedAt = now;
        count += 1;
      }
    }
    return count;
  }

  async revokeSessionGrants(userId: number, now: number): Promise<number> {
    let count = 0;
    for (const grant of this.grants.values()) {
      if (
        grant.userId === userId &&
        grant.scope === 'session' &&
        grant.status === 'active'
      ) {
        grant.status = 'revoked';
        grant.revokedAt = now;
        count += 1;
      }
    }
    return count;
  }

  async listGrants(userId: number): Promise<PermissionGrantRecord[]> {
    return Array.from(this.grants.values()).filter((grant) => grant.userId === userId);
  }

  async listRequests(userId: number): Promise<PermissionRequestRecord[]> {
    return Array.from(this.requests.values()).filter((request) => request.userId === userId);
  }

  async listAudit(userId: number): Promise<PermissionAuditRecord[]> {
    return this.audits.filter((entry) => entry.userId === userId);
  }

  async listDenials(userId: number): Promise<PermissionDenialRecord[]> {
    return Array.from(this.denials.values()).filter((entry) => entry.userId === userId);
  }

  async listPreferences(userId: number): Promise<PermissionPreferenceRecord[]> {
    return Array.from(this.preferences.values()).filter((entry) => entry.userId === userId);
  }

  async listDevices(): Promise<[]> {
    return [];
  }
}

function makeManager(store = new FakePermissionStore()) {
  const manager = new PermissionManager();
  const activities: Record<string, unknown>[] = [];

  Object.assign(manager, {
    db: {} as SQLiteDatabase,
    store,
    ready: Promise.resolve(),
    sessionId: 'session-1',
    activityStore: {
      append: async (input: Record<string, unknown>) => {
        const record = { id: `act_${activities.length + 1}`, ...input };
        activities.push(record);
        return record;
      },
      list: async () => activities,
      listForConversation: async () => activities,
      verifyChain: async () => true,
    },
    safetyStore: {
      insertOperation: async () => undefined,
      updateOperationStatus: async () => undefined,
      listOperations: async () => [],
    },
  });

  manager.getState().queue = [];
  manager.getState().emergencyStop = false;
  manager.getState().stoppedAgents = [];
  manager.getState().loading = false;

  return { manager, store, activities };
}

async function flush(): Promise<void> {
  for (let index = 0; index < 16; index += 1) {
    await Promise.resolve();
  }
}

function expectedFor(classified: ClassifiedPermissionAction) {
  return {
    agentId: classified.agent.id,
    toolName: classified.toolName,
    category: classified.category,
    scopeKey: classified.scopeKey,
    resourceKey: classified.resourceKey,
    fingerprint: classified.fingerprint,
    freshConfirmation: classified.freshConfirmation,
    external: classified.external,
    reversible: classified.reversible,
  };
}

describe('agent safety decisions', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    uuid.value = 0;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('denies the current action and records that nothing executed', async () => {
    const { manager } = makeManager();
    const classified = action('file_restore', { trash_id: 'trash-1' });
    const pending = manager.requestToolPermission({
      userId: 1,
      conversationId: 9,
      action: classified,
      policy: { decision: 'ask', ruleId: null },
    });
    await flush();

    expect(manager.getState().queue).toHaveLength(1);
    expect(await manager.resolveRequest(manager.getState().queue[0].id, 'deny', 1)).toEqual({
      ok: true,
    });

    await expect(pending).resolves.toMatchObject({
      allowed: false,
      reason: 'user_denied',
    });
  });

  it('makes Never Allow exact-scope and revocable', async () => {
    const { manager, store } = makeManager();
    const classified = action('file_restore', { trash_id: 'trash-1' });
    const first = manager.requestToolPermission({
      userId: 1,
      action: classified,
      policy: { decision: 'ask', ruleId: null },
    });
    await flush();
    const requestId = manager.getState().queue[0].id;
    await manager.resolveRequest(requestId, 'never_allow', 1);
    await expect(first).resolves.toMatchObject({ allowed: false, reason: 'never_allowed' });

    const blocked = await manager.requestToolPermission({
      userId: 1,
      action: classified,
      policy: { decision: 'ask', ruleId: null },
    });
    expect(blocked).toMatchObject({ allowed: false, reason: 'never_allowed' });
    expect(manager.getState().queue).toHaveLength(0);

    const denial = Array.from(store.denials.values())[0];
    expect(await manager.revokeDenial(1, denial.id)).toBe(true);
    void manager.requestToolPermission({
      userId: 1,
      action: classified,
      policy: { decision: 'ask', ruleId: null },
    });
    await flush();
    expect(manager.getState().queue).toHaveLength(1);
  });

  it('Ask Every Time authorizes once but never bypasses the next request', async () => {
    const { manager, store } = makeManager();
    const classified = action('file_restore', { trash_id: 'trash-1' });
    const first = manager.requestToolPermission({
      userId: 1,
      action: classified,
      policy: { decision: 'ask', ruleId: null },
    });
    await flush();
    await manager.resolveRequest(manager.getState().queue[0].id, 'ask_every_time', 1);

    await expect(first).resolves.toMatchObject({ allowed: true, via: 'allow_once' });
    expect(Array.from(store.preferences.values())[0]).toMatchObject({
      choice: 'ask_every_time',
      resourceKey: classified.resourceKey,
    });

    void manager.requestToolPermission({
      userId: 1,
      action: classified,
      policy: { decision: 'ask', ruleId: null },
    });
    await flush();
    expect(manager.getState().queue).toHaveLength(1);
  });

  it('Allow for session reuses only the exact scoped call', async () => {
    const { manager } = makeManager();
    const classified = action('file_restore', { trash_id: 'trash-1' });
    const input = { userId: 1, action: classified, policy: { decision: 'allow' as const, ruleId: null } };
    const first = manager.requestToolPermission(input);
    await flush();
    await manager.resolveRequest(manager.getState().queue[0].id, 'allow_session', 1);
    const granted = await first;
    expect(granted).toMatchObject({ allowed: true, via: 'allow_session' });

    await expect(manager.requestToolPermission(input)).resolves.toMatchObject({
      allowed: true,
      via: 'existing_grant',
    });

    void manager.requestToolPermission({
      ...input,
      action: action('file_restore', { trash_id: 'trash-2' }),
    });
    await flush();
    expect(manager.getState().queue).toHaveLength(1);
  });

  it('Always Allow is narrow, revocable, and revalidated before execution', async () => {
    const { manager } = makeManager();
    const classified = action('file_restore', { trash_id: 'trash-1' });
    const input = { userId: 1, action: classified, policy: { decision: 'allow' as const, ruleId: null } };
    const first = manager.requestToolPermission(input);
    await flush();
    await manager.resolveRequest(manager.getState().queue[0].id, 'always_allow', 1);
    const granted = await first;

    if (!granted.allowed) {
      throw new Error('The first request should have been approved.');
    }

    expect(granted.via).toBe('always_allow');
    await expect(manager.requestToolPermission(input)).resolves.toMatchObject({
      allowed: true,
      via: 'existing_grant',
    });
    await flush();

    const exact = expectedFor(classified);
    await expect(manager.beginExecution(granted.authorization, exact)).resolves.toMatchObject({
      ok: true,
    });
    await expect(manager.beginExecution(granted.authorization, exact)).resolves.toMatchObject({
      ok: false,
      reason: 'authorization_expired',
    });

    expect(await manager.revokeAgentGrants(1, AGENT.id)).toBe(1);
    void manager.requestToolPermission(input);
    await flush();
    expect(manager.getState().queue).toHaveLength(1);
  });

  it('rejects scope substitution even with a live authorization', async () => {
    const { manager } = makeManager();
    const classified = action('file_restore', { trash_id: 'trash-1' });
    const pending = manager.requestToolPermission({
      userId: 1,
      action: classified,
      policy: { decision: 'ask', ruleId: null },
    });
    await flush();
    await manager.resolveRequest(manager.getState().queue[0].id, 'allow_once', 1);
    const outcome = await pending;

    if (!outcome.allowed) {
      throw new Error('The request should have been approved once.');
    }

    const result = await manager.beginExecution(outcome.authorization, {
      ...expectedFor(classified),
      fingerprint: 'tampered-fingerprint',
    });
    expect(result).toMatchObject({ ok: false, reason: 'scope_mismatch' });
  });

  it('never allows saved approval for high or critical actions', async () => {
    for (const toolName of ['google_drive_trash', 'google_gmail_send']) {
      const { manager } = makeManager();
      const classified = action(toolName, { to: 'someone@example.com', body: 'Hello' });
      const pending = manager.requestToolPermission({
        userId: 1,
        action: classified,
        policy: { decision: 'ask', ruleId: null },
      });
      await flush();
      const id = manager.getState().queue[0].id;

      expect(await manager.resolveRequest(id, 'always_allow', 1)).toMatchObject({ ok: false });
      expect(await manager.resolveRequest(id, 'allow_session', 1)).toMatchObject({ ok: false });
      expect(await manager.resolveRequest(id, 'allow_once', 1)).toEqual({ ok: true });
      const outcome = await pending;
      expect(outcome).toMatchObject({ allowed: true, via: 'allow_once' });

      if (!outcome.allowed) {
        throw new Error('The request should have been approved once.');
      }

      await expect(
        manager.beginExecution(outcome.authorization, expectedFor(classified))
      ).resolves.toMatchObject({ ok: true });
    }
  });

  it('emergency stop cancels cancellable work, reports uncertain work, and revokes grants', async () => {
    const { manager, store } = makeManager();
    await store.insertGrant({
      id: 'grant-1',
      userId: 1,
      requestId: null,
      agentId: AGENT.id,
      agentName: AGENT.name,
      toolName: 'file_restore',
      category: 'file_write',
      scopeKey: 'file_restore:project-1:trash-1',
      resourceKey: 'file_restore:project-1:trash-1',
      fingerprint: 'fp',
      projectId: 'project-1',
      projectLabel: 'Orbit',
      scope: 'persistent',
      sessionId: '',
      choice: 'always_allow',
      narrow: true,
      risk: 'medium',
      title: 'Restore file',
      createdAt: Date.now(),
      expiresAt: Date.now() + 100_000,
      lastUsedAt: null,
      useCount: 0,
      maxUses: null,
      revokedAt: null,
      status: 'active',
    });

    const cancellable = manager.startOperation({
      userId: 1,
      agentId: AGENT.id,
      agentName: AGENT.name,
      toolName: 'file_restore',
      detail: 'Restore file',
      cancellable: true,
      external: false,
    });
    manager.startOperation({
      userId: 1,
      agentId: AGENT.id,
      agentName: AGENT.name,
      toolName: 'google_gmail_send',
      detail: 'Send email',
      cancellable: false,
      external: true,
    });

    await manager.emergencyStop(1);

    expect(cancellable.signal.aborted).toBe(true);
    expect(manager.getStopReport()).toMatchObject({
      stopRequested: ['Developer Agent · file_restore'],
      uncancellable: ['Developer Agent · google_gmail_send (external service may have completed)'],
      revokedGrants: 1,
    });

    await expect(
      manager.requestToolPermission({
        userId: 1,
        action: action('file_restore', { trash_id: 'trash-1' }),
        policy: { decision: 'ask', ruleId: null },
      })
    ).resolves.toMatchObject({ allowed: false, reason: 'emergency_stop' });

    await manager.resumePermissions(1);
    void manager.requestToolPermission({
      userId: 1,
      action: action('file_restore', { trash_id: 'trash-1' }),
      policy: { decision: 'ask', ruleId: null },
    });
    await flush();
    expect(manager.getState().queue).toHaveLength(1);
  });

  it('rejects unknown decisions without issuing an authorization', async () => {
    const { manager, store } = makeManager();
    const pending = manager.requestToolPermission({
      userId: 1,
      action: action('file_restore', { trash_id: 'trash-1' }),
      policy: { decision: 'ask', ruleId: null },
    });
    await flush();
    const id = manager.getState().queue[0].id;

    await expect(
      manager.resolveRequest(id, 'unknown' as PermissionDecisionOption, 1)
    ).resolves.toMatchObject({ ok: false });
    expect(manager.getState().queue).toHaveLength(1);
    expect(await store.listGrants(1)).toHaveLength(0);

    await manager.cancelRequest(id, 1);
    await expect(pending).resolves.toMatchObject({ allowed: false, reason: 'user_cancelled' });
  });

  it('does not publish a grant when a stop arrives mid-decision', async () => {
    const { manager, store } = makeManager();
    let releaseInsert!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    const originalInsertGrant = store.insertGrant.bind(store);
    store.insertGrant = async (grant) => {
      await gate;
      await originalInsertGrant(grant);
    };

    const pending = manager.requestToolPermission({
      userId: 1,
      action: action('file_restore', { trash_id: 'trash-1' }),
      policy: { decision: 'ask', ruleId: null },
    });
    await flush();
    const resolving = manager.resolveRequest(manager.getState().queue[0].id, 'allow_once', 1);
    await flush();

    await manager.emergencyStop(1);
    releaseInsert();

    await expect(resolving).resolves.toMatchObject({ ok: false });
    await expect(pending).resolves.toMatchObject({ allowed: false, reason: 'emergency_stop' });
    expect((await store.listGrants(1)).filter((grant) => grant.status === 'active')).toHaveLength(0);
  });

  it('keeps a stop authoritative when the approval finishes during the stop write', async () => {
    const { manager, store } = makeManager();
    let releaseInsert!: () => void;
    let releaseStopAudit!: () => void;
    let stopAuditStarted!: () => void;
    const insertGate = new Promise<void>((resolve) => {
      releaseInsert = resolve;
    });
    const stopAuditGate = new Promise<void>((resolve) => {
      releaseStopAudit = resolve;
    });
    const stopAuditReached = new Promise<void>((resolve) => {
      stopAuditStarted = resolve;
    });

    const originalInsertGrant = store.insertGrant.bind(store);
    store.insertGrant = async (grant) => {
      await insertGate;
      await originalInsertGrant(grant);
    };
    const originalAddAudit = store.addAudit.bind(store);
    store.addAudit = async (record) => {
      if (record.event === 'cancelled') {
        stopAuditStarted();
        await stopAuditGate;
      }
      await originalAddAudit(record);
    };

    const pending = manager.requestToolPermission({
      userId: 1,
      action: action('file_restore', { trash_id: 'trash-1' }),
      policy: { decision: 'ask', ruleId: null },
    });
    await flush();
    const resolving = manager.resolveRequest(manager.getState().queue[0].id, 'allow_once', 1);
    await flush();

    const stopping = manager.emergencyStop(1);
    await stopAuditReached;
    releaseInsert();

    await expect(resolving).resolves.toMatchObject({ ok: false });
    releaseStopAudit();
    await stopping;

    await expect(pending).resolves.toMatchObject({ allowed: false, reason: 'emergency_stop' });
    expect((await store.listGrants(1)).filter((grant) => grant.status === 'active')).toHaveLength(0);
  });

  it('reports an uncancellable external dashboard stop as unconfirmed', async () => {
    const { manager } = makeManager();
    const operation = manager.startOperation({
      userId: 1,
      agentId: AGENT.id,
      agentName: AGENT.name,
      toolName: 'google_gmail_send',
      detail: 'Send email',
      cancellable: false,
      external: true,
    });

    const result = await manager.cancelOperation(1, operation.id);

    expect(result).toMatchObject({ handled: true, state: 'external_unconfirmed' });
    expect(result.message).toMatch(/external result may persist/i);
  });
});
