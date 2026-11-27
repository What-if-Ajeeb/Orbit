import * as Crypto from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import { redactSecrets } from '../permissions/redact';
import {
  appendHybridAuditEvent,
  listHybridAuditEvents,
  verifyHybridAuditChain,
} from '../agent-runtime/task-manager';

import type { HybridTraceContext } from './types';

export function newHybridTraceId(): string {
  return `hybrid_${Crypto.randomUUID()}`;
}

export function traceContext(
  traceId: string,
  extra: Partial<Omit<HybridTraceContext, 'traceId'>> = {}
): HybridTraceContext {
  return { traceId, ...extra };
}

/** Redacts secrets before any payload reaches the append-only audit ledger. */
function sanitize(payload: Record<string, unknown>): Record<string, unknown> {
  try {
    return JSON.parse(redactSecrets(JSON.stringify(payload ?? {}))) as Record<string, unknown>;
  } catch {
    return { redactionFailed: true };
  }
}

export async function recordHybridEvent(
  db: SQLiteDatabase,
  input: {
    traceId: string;
    taskId?: string | null;
    userId?: number | null;
    source: string;
    type: string;
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  await appendHybridAuditEvent(db, {
    traceId: input.traceId,
    taskId: input.taskId ?? null,
    userId: input.userId ?? null,
    source: input.source,
    type: input.type,
    payload: sanitize(input.payload ?? {}),
  });
}

export async function readHybridTrace(
  db: SQLiteDatabase,
  traceId: string,
  limit = 500
) {
  return listHybridAuditEvents(db, traceId, limit);
}

export async function verifyHybridTrace(
  db: SQLiteDatabase,
  traceId: string
): Promise<boolean> {
  return verifyHybridAuditChain(db, traceId);
}
