import type { SQLiteDatabase } from 'expo-sqlite';

import { MemoryStore, type MemoryEntry, type MemoryScope } from '../memory/store';
import { recordHybridEvent } from '../hybrid-agent/audit';

import {
  assertWriteFitsBudget,
  memoryWriteFingerprint,
  stageMemoryWrite,
} from './memory-budget';
import type {
  HermesMemoryAction,
  HermesMemoryEntry,
  HermesMemoryTarget,
  HermesStagedWrite,
} from './types';

/** Matches the hybrid approval ledger's default TTL. */
export const HERMES_MEMORY_WRITE_TTL_MS = 10 * 60_000;

type WriteState = HermesStagedWrite['status'];

type WriteRow = {
  id: string;
  user_id: number;
  agent_id: string;
  target: HermesMemoryTarget;
  action: HermesMemoryAction;
  project_key: string;
  key: string;
  value: string;
  policy_version: string;
  fingerprint: string;
  source: string;
  confidence: number;
  requested_at: number;
  resolved_at: number | null;
  applied_at: number | null;
  state: WriteState;
};

const COLUMNS = `id, user_id, agent_id, target, action, project_key, key, value,
  policy_version, fingerprint, source, confidence, requested_at, resolved_at,
  applied_at, state`;

function scopeFor(target: HermesMemoryTarget): MemoryScope {
  return target === 'user' ? 'user' : 'agent';
}

function rowToWrite(row: WriteRow): HermesStagedWrite {
  return {
    id: row.id,
    target: row.target,
    action: row.action,
    key: row.key,
    value: row.value,
    policyVersion: row.policy_version,
    fingerprint: row.fingerprint,
    requestedAt: row.requested_at,
    status: row.state,
  };
}

function asWrite(value: HermesStagedWrite): HermesStagedWrite {
  return { ...value };
}

async function audit(
  db: SQLiteDatabase,
  input: { userId: number; type: string; payload: Record<string, unknown> }
): Promise<void> {
  try {
    await recordHybridEvent(db, {
      traceId: `hermes_mem_${String(input.payload.fingerprint ?? 'unknown').slice(0, 16)}`,
      userId: input.userId,
      source: 'hermes',
      type: input.type,
      payload: input.payload,
    });
  } catch (error) {
    // A memory write must never be blocked by an unavailable audit ledger.
    console.warn('Could not record Hermes memory-write audit event.', error);
  }
}

async function getRow(
  db: SQLiteDatabase,
  userId: number,
  id: string
): Promise<WriteRow | null> {
  return (await db.getFirstAsync(
    `SELECT ${COLUMNS} FROM hermes_memory_writes WHERE id = ? AND user_id = ?`,
    id,
    userId
  )) as WriteRow | null;
}

/**
 * Stores an exact preview of a proposed memory mutation. This is data only:
 * nothing here grants approval or writes to `agent_memory`.
 */
export async function stageHermesMemoryWrite(
  db: SQLiteDatabase,
  input: {
    userId: number;
    agentId?: string;
    target: HermesMemoryTarget;
    action: HermesMemoryAction;
    key: string;
    value: string;
    policyVersion: string;
    source?: string;
    confidence?: number;
    now?: number;
  }
): Promise<HermesStagedWrite> {
  const staged = stageMemoryWrite({
    target: input.target,
    action: input.action,
    key: input.key,
    value: input.value,
    policyVersion: input.policyVersion,
    requestedAt: input.now ?? Date.now(),
  });

  const existing = (await db.getFirstAsync(
    `SELECT ${COLUMNS} FROM hermes_memory_writes
     WHERE user_id = ? AND fingerprint = ? AND state = 'pending'`,
    input.userId,
    staged.fingerprint
  )) as WriteRow | null;
  if (existing) return asWrite(rowToWrite(existing));

  await db.runAsync(
    `INSERT INTO hermes_memory_writes (
      id, user_id, agent_id, target, action, project_key, key, value,
      policy_version, fingerprint, source, confidence, requested_at, state
    ) VALUES (?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, ?, ?, 'pending')
     ON CONFLICT(id) DO NOTHING`,
    staged.id,
    input.userId,
    input.agentId ?? 'master',
    staged.target,
    staged.action,
    staged.key,
    staged.value,
    staged.policyVersion,
    staged.fingerprint,
    (input.source ?? 'agent').slice(0, 80),
    Math.max(0, Math.min(1, input.confidence ?? 1)),
    staged.requestedAt
  );

  const row = await getRow(db, input.userId, staged.id);
  if (!row) throw new Error('The staged memory write could not be read back.');
  await audit(db, {
    userId: input.userId,
    type: 'memory.write.staged',
    payload: {
      id: row.id,
      target: row.target,
      key: row.key,
      fingerprint: row.fingerprint,
      policyVersion: row.policy_version,
    },
  });
  return asWrite(rowToWrite(row));
}

export async function getHermesMemoryWrite(
  db: SQLiteDatabase,
  userId: number,
  id: string
): Promise<HermesStagedWrite | null> {
  const row = await getRow(db, userId, id);
  return row ? asWrite(rowToWrite(row)) : null;
}

export async function listHermesMemoryWrites(
  db: SQLiteDatabase,
  userId: number,
  state?: WriteState
): Promise<HermesStagedWrite[]> {
  const rows = (await db.getAllAsync(
    `SELECT ${COLUMNS} FROM hermes_memory_writes
     WHERE user_id = ? ${state ? 'AND state = ?' : ''}
     ORDER BY requested_at DESC, id DESC`,
    ...(state ? [userId, state] : [userId])
  )) as WriteRow[];
  return rows.map((row) => asWrite(rowToWrite(row)));
}

/**
 * Records a user decision. Callers must pass the decision from the trusted
 * approval UI; an AI proposal never supplies its own approval.
 */
export async function decideHermesMemoryWrite(
  db: SQLiteDatabase,
  input: {
    userId: number;
    id: string;
    fingerprint: string;
    decision: 'approved' | 'denied';
    policyVersion?: string;
    now?: number;
  }
): Promise<HermesStagedWrite> {
  const row = await getRow(db, input.userId, input.id);
  if (!row) throw new Error('Staged memory write not found.');
  if (row.state !== 'pending') return asWrite(rowToWrite(row));

  if (row.fingerprint !== input.fingerprint) {
    await db.runAsync(
      `UPDATE hermes_memory_writes SET state = 'invalidated', resolved_at = ?
       WHERE id = ? AND user_id = ?`,
      input.now ?? Date.now(),
      input.id,
      input.userId
    );
    throw new Error('Memory write approval fingerprint does not match the staged proposal.');
  }
  if (input.policyVersion && row.policy_version !== input.policyVersion) {
    throw new Error('Memory write policy version changed before approval.');
  }

  const now = input.now ?? Date.now();
  await db.runAsync(
    `UPDATE hermes_memory_writes SET state = ?, resolved_at = ?
     WHERE id = ? AND user_id = ? AND state = 'pending'`,
    input.decision,
    now,
    input.id,
    input.userId
  );

  const updated = await getRow(db, input.userId, input.id);
  if (!updated) throw new Error('The memory write decision could not be read back.');
  await audit(db, {
    userId: input.userId,
    type: input.decision === 'approved' ? 'memory.write.approved' : 'memory.write.denied',
    payload: {
      id: updated.id,
      target: updated.target,
      key: updated.key,
      fingerprint: updated.fingerprint,
      resolvedAt: now,
    },
  });
  return asWrite(rowToWrite(updated));
}

function currentEntries(rows: MemoryEntry[], target: HermesMemoryTarget): HermesMemoryEntry[] {
  return rows.map((row) => ({
    target,
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt,
  }));
}

/**
 * Applies only an approved, unmodified, unexpired stage through MemoryStore.
 * Every privileged boundary remains unchanged; this module never grants itself
 * an approval and never bypasses policy.
 */
export async function applyHermesMemoryWrite(
  db: SQLiteDatabase,
  input: { userId: number; id: string; fingerprint?: string; now?: number }
): Promise<HermesStagedWrite> {
  const now = input.now ?? Date.now();
  const row = await getRow(db, input.userId, input.id);
  if (!row) throw new Error('Staged memory write not found.');
  if (row.state === 'applied') return asWrite(rowToWrite(row));
  if (row.state !== 'approved') {
    throw new Error('Only an approved memory write can be applied.');
  }
  if (row.requested_at + HERMES_MEMORY_WRITE_TTL_MS <= now) {
    await db.runAsync(
      `UPDATE hermes_memory_writes SET state = 'expired', resolved_at = ?
       WHERE id = ? AND user_id = ?`,
      now,
      row.id,
      row.user_id
    );
    throw new Error('The memory write approval expired.');
  }

  const staged = rowToWrite(row);
  const expectedFingerprint = memoryWriteFingerprint({
    target: row.target,
    action: row.action,
    key: row.key,
    value: row.value,
    policyVersion: row.policy_version,
  });

  const invalidate = async (reason: string): Promise<never> => {
    await db.runAsync(
      `UPDATE hermes_memory_writes SET state = 'invalidated', resolved_at = ?
       WHERE id = ? AND user_id = ?`,
      now,
      row.id,
      row.user_id
    );
    throw new Error(reason);
  };

  if (
    expectedFingerprint !== row.fingerprint ||
    (input.fingerprint && input.fingerprint !== row.fingerprint)
  ) {
    return invalidate('Memory write changed after approval and was invalidated.');
  }

  const store = new MemoryStore(db);
  const scope = scopeFor(row.target);
  const existing = await store.recall({
    userId: row.user_id,
    agentId: row.agent_id,
    scope,
    limit: 100,
    includeExpired: true,
  });
  const entries = currentEntries(existing, row.target);
  const matching = entries.filter((entry) => entry.key === row.key);

  if (row.action === 'add' && matching.length > 0) {
    return invalidate('Memory entry already exists; an add write was invalidated.');
  }
  if (row.action === 'patch' && matching.length !== 1) {
    return invalidate('A patch write requires exactly one existing memory entry.');
  }

  try {
    assertWriteFitsBudget(entries, staged);
  } catch (error) {
    return invalidate(error instanceof Error ? error.message : 'Memory write overflowed its budget.');
  }

  await db.withTransactionAsync(async () => {
    const fresh = await getRow(db, input.userId, input.id);
    if (!fresh || fresh.state !== 'approved') {
      throw new Error('The memory write was resolved before it could be applied.');
    }

    if (row.action === 'remove') {
      await store.forget({
        userId: row.user_id,
        agentId: row.agent_id,
        scope,
        key: row.key,
      });
    } else {
      await store.remember({
        userId: row.user_id,
        agentId: row.agent_id,
        scope,
        key: row.key,
        value: row.value,
        source: row.source,
        confidence: row.confidence,
      });
    }

    await db.runAsync(
      `UPDATE hermes_memory_writes SET state = 'applied', applied_at = ?, resolved_at = ?
       WHERE id = ? AND user_id = ? AND state = 'approved'`,
      now,
      now,
      row.id,
      row.user_id
    );
  });

  const applied = await getRow(db, input.userId, input.id);
  if (!applied) throw new Error('The applied memory write could not be read back.');
  await audit(db, {
    userId: input.userId,
    type: 'memory.write.applied',
    payload: {
      id: applied.id,
      target: applied.target,
      key: applied.key,
      action: applied.action,
      fingerprint: applied.fingerprint,
      appliedAt: now,
    },
  });
  return asWrite(rowToWrite(applied));
}
