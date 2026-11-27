import type { SQLiteDatabase } from 'expo-sqlite';

import { hashChain } from '../agent-runtime/hash';
import { MemoryStore, type MemoryEntry } from '../memory/store';
import { isSecretKey, redactSecrets } from '../permissions/redact';

import type {
  HermesMemoryAction,
  HermesMemoryEntry,
  HermesMemorySnapshot,
  HermesMemoryTarget,
  HermesStagedWrite,
} from './types';

/** Hermes-equivalent char budgets; writes that would overflow must consolidate. */
export const HERMES_MEMORY_LIMITS: Record<HermesMemoryTarget, number> = {
  agent: 2_200,
  user: 1_375,
};

const MAX_ENTRY_CHARS = 500;
const ENTRIES_PER_TARGET = 20;

/**
 * Memory is untrusted prompt data. Strings that try to rewrite instructions or
 * ask for secrets are rejected before they can enter a frozen prompt snapshot.
 */
const INJECTION_PATTERN =
  /(?:ignore|disregard)\s+(?:all\s+)?(?:previous|prior|above|earlier|system)\s+instructions|(?:reveal|show|print)\s+(?:your\s+)?(?:system\s+prompt|api\s+key|password|secret)|you\s+are\s+now|bypass\s+(?:the\s+)?(?:sandbox|permission|policy)|grant\s+(?:yourself\s+)?(?:permission|access)|<\|(?:system|assistant|user)\|>|```(?:system|instructions)/i;

/** Redacts and bounds one value; returns null when it is unsafe or empty. */
export function sanitizeMemoryValue(value: string): string | null {
  const cleaned = redactSecrets(value.replace(/\s+/g, ' ').trim()).slice(0, MAX_ENTRY_CHARS);
  if (!cleaned || INJECTION_PATTERN.test(cleaned)) return null;
  return cleaned;
}

function normalizeValue(value: string): string {
  return sanitizeMemoryValue(value) ?? '';
}

function entryChars(entry: HermesMemoryEntry): number {
  return `${entry.key}: ${normalizeValue(entry.value)}`.length;
}

/**
 * Bounds a store without silently changing entries: candidates are consumed in
 * order until the budget is exhausted, and the count of skipped entries is
 * reported so the caller can surface a consolidation prompt.
 */
export function budgetMemoryEntries(
  target: HermesMemoryTarget,
  entries: HermesMemoryEntry[]
): { entries: HermesMemoryEntry[]; chars: number; omitted: number } {
  const limit = HERMES_MEMORY_LIMITS[target];
  const kept: HermesMemoryEntry[] = [];
  let chars = 0;
  let omitted = 0;

  for (const entry of entries) {
    if (entry.target !== target) continue;
    const value = normalizeValue(entry.value);
    if (!entry.key.trim() || isSecretKey(entry.key) || !value) {
      omitted += 1;
      continue;
    }
    const normalized = { ...entry, key: entry.key.trim().slice(0, 120), value };
    const cost = entryChars(normalized);
    if (chars + cost > limit) {
      omitted += 1;
      continue;
    }
    kept.push(normalized);
    chars += cost;
  }

  return { entries: kept, chars, omitted };
}

export function buildMemorySnapshot(input: {
  entries: HermesMemoryEntry[];
  frozenAt: number;
}): HermesMemorySnapshot {
  const agent = budgetMemoryEntries('agent', input.entries);
  const user = budgetMemoryEntries('user', input.entries);

  return {
    agent: agent.entries,
    user: user.entries,
    chars: { agent: agent.chars, user: user.chars },
    limits: { ...HERMES_MEMORY_LIMITS },
    omitted: { agent: agent.omitted, user: user.omitted },
    fingerprint: hashChain({
      agent: agent.entries,
      user: user.entries,
      frozenAt: input.frozenAt,
    }),
    frozenAt: input.frozenAt,
  };
}

function dedupeByKey(rows: MemoryEntry[]): MemoryEntry[] {
  const byKey = new Map<string, MemoryEntry>();
  for (const row of rows) {
    const existing = byKey.get(row.key);
    if (!existing || row.updatedAt > existing.updatedAt || row.version > existing.version) {
      byKey.set(row.key, row);
    }
  }
  return Array.from(byKey.values());
}

/**
 * Reads the structured store once. Long-term memories are treated as agent
 * memory; user memories are deduplicated by key because they are shared across
 * agents. The returned snapshot is frozen at `frozenAt` and never refreshed.
 */
export async function loadHermesMemorySnapshot(input: {
  db: SQLiteDatabase;
  userId: number;
  agentId: string;
  now?: number;
}): Promise<HermesMemorySnapshot> {
  const store = new MemoryStore(input.db);
  const [userRows, agentRows, longTermRows] = await Promise.all([
    store.recall({ userId: input.userId, agentId: input.agentId, scope: 'user', limit: ENTRIES_PER_TARGET }),
    store.recall({ userId: input.userId, agentId: input.agentId, scope: 'agent', limit: ENTRIES_PER_TARGET }),
    store.recall({ userId: input.userId, agentId: input.agentId, scope: 'long_term', limit: ENTRIES_PER_TARGET }),
  ]);

  const toEntry = (row: MemoryEntry, target: HermesMemoryTarget): HermesMemoryEntry => ({
    target,
    key: row.key,
    value: row.value,
    updatedAt: row.updatedAt,
  });

  return buildMemorySnapshot({
    entries: [
      ...dedupeByKey(userRows).map((row) => toEntry(row, 'user')),
      ...dedupeByKey([...agentRows, ...longTermRows]).map((row) => toEntry(row, 'agent')),
    ],
    frozenAt: input.now ?? Date.now(),
  });
}

/** Frozen prompt text with visible usage, matching Hermes' header format. */
export function formatMemorySnapshot(snapshot: HermesMemorySnapshot): string {
  const section = (
    target: HermesMemoryTarget,
    label: string,
    entries: HermesMemoryEntry[]
  ): string => {
    if (entries.length === 0) return '';
    const usage = `${snapshot.chars[target]}/${snapshot.limits[target]} chars`;
    const lines = entries.map((entry) => `- [${target}:${entry.key}] ${entry.value}`);
    const omitted = snapshot.omitted[target] > 0 ? `\n- ${snapshot.omitted[target]} entry/entries omitted (consolidate to make room).` : '';
    return `${label} [${usage}]:\n${lines.join('\n')}${omitted}`;
  };

  return [
    section('user', 'User profile', snapshot.user),
    section('agent', 'Agent memory', snapshot.agent),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Exact binding for a staged memory write; no timestamp is part of the hash. */
export function memoryWriteFingerprint(input: {
  target: HermesMemoryTarget;
  action: HermesMemoryAction;
  key: string;
  value: string;
  policyVersion: string;
}): string {
  return hashChain({
    target: input.target,
    action: input.action,
    key: input.key.trim(),
    value: sanitizeMemoryValue(input.value) ?? '',
    policyVersion: input.policyVersion,
  });
}

export function stageMemoryWrite(input: {
  target: HermesMemoryTarget;
  action: HermesMemoryAction;
  key: string;
  value: string;
  policyVersion: string;
  requestedAt: number;
}): HermesStagedWrite {
  const key = input.key.trim().replace(/\s+/g, '_').slice(0, 120);
  if (!key || isSecretKey(key)) throw new Error('A safe memory key is required.');
  const value = sanitizeMemoryValue(input.value);
  if (!value) throw new Error('A safe, non-injection memory value is required.');

  const fingerprint = memoryWriteFingerprint({ ...input, key, value });
  return {
    target: input.target,
    action: input.action,
    key,
    value,
    policyVersion: input.policyVersion,
    fingerprint,
    requestedAt: input.requestedAt,
    status: 'pending',
    id: `memwrite_${fingerprint.slice(0, 16)}_${input.requestedAt}`,
  };
}

/**
 * Validates that an approval still matches the exact staged operation. The
 * caller must also verify the approval record itself was granted by the user.
 */
export function approvalMatchesWrite(
  write: HermesStagedWrite,
  approval: { fingerprint: string; status: 'approved' | 'denied' | 'expired'; grantedAt?: number }
): boolean {
  return approval.status === 'approved' && approval.fingerprint === write.fingerprint;
}

/** Pure mutation used only after an exact approval has been verified. */
export function applyStagedWrite(
  entries: HermesMemoryEntry[],
  write: HermesStagedWrite
): HermesMemoryEntry[] {
  const sameKey = (entry: HermesMemoryEntry) =>
    entry.target === write.target && entry.key === write.key;

  if (write.action === 'remove') {
    return entries.filter((entry) => !sameKey(entry));
  }

  if (write.action === 'add') {
    if (entries.some(sameKey)) return entries;
    return [
      ...entries,
      { target: write.target, key: write.key, value: write.value, updatedAt: write.requestedAt },
    ];
  }

  if (write.action === 'patch') {
    const matches = entries.filter(sameKey);
    if (matches.length !== 1) {
      throw new Error('Memory patch requires exactly one matching entry.');
    }
    return entries.map((entry) =>
      sameKey(entry) ? { ...entry, value: write.value, updatedAt: write.requestedAt } : entry
    );
  }

  return entries;
}

/**
 * Rejects a write that would overflow the target budget instead of dropping
 * entries silently. The caller must consolidate before retrying.
 */
export function assertWriteFitsBudget(
  entries: HermesMemoryEntry[],
  write: HermesStagedWrite
): void {
  const next = applyStagedWrite(entries, write);
  const result = budgetMemoryEntries(write.target, next);
  if (result.omitted > 0) {
    throw new Error(
      `Memory write would exceed the ${write.target} budget by ${result.omitted} entry/entries. Consolidate first.`
    );
  }
}
