import type { SQLiteDatabase } from 'expo-sqlite';

import { hashChain } from '../agent-runtime/hash';
import { recordHybridEvent } from '../hybrid-agent/audit';

import type { ProviderErrorKind } from './types';

export type DeliveryStage = 'queued' | 'started' | 'delivered' | 'failed';

/** Stable trace key for one claimed schedule, reused across all four stages. */
export function deliveryTraceId(scheduleId: string, owner: string): string {
  return `delivery_${scheduleId}_${hashChain({ scheduleId, owner }).slice(0, 12)}`;
}

/** Hash-only content marker; instruction and reply text never enter the ledger. */
export function deliveryContentHash(text: string): string {
  return hashChain({ text });
}

/**
 * Records a delivery stage in the hash-chained hybrid audit ledger. Payloads
 * are allowlisted: hashes, ids, counts and fixed error categories only.
 */
export async function recordDeliveryEvent(
  db: SQLiteDatabase,
  input: {
    traceId: string;
    scheduleId: string;
    userId: number;
    stage: DeliveryStage;
    taskId?: string | null;
    bundleIds?: string[];
    contentHash?: string;
    status?: string;
    verified?: boolean;
    durationMs?: number;
    errorKind?: ProviderErrorKind | 'unknown';
  }
): Promise<void> {
  try {
    await recordHybridEvent(db, {
      traceId: input.traceId,
      taskId: input.taskId ?? null,
      userId: input.userId,
      source: 'scheduler',
      type: `delivery.${input.stage}`,
      payload: {
        scheduleId: input.scheduleId,
        stage: input.stage,
        ...(input.taskId ? { taskId: input.taskId } : {}),
        ...(input.bundleIds ? { bundleIds: input.bundleIds } : {}),
        ...(input.contentHash ? { contentHash: input.contentHash } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.verified === undefined ? {} : { verified: input.verified }),
        ...(input.durationMs === undefined
          ? {}
          : { durationMs: Math.max(0, Math.round(input.durationMs)) }),
        ...(input.errorKind ? { errorKind: input.errorKind } : {}),
      },
    });
  } catch (error) {
    // Telemetry must never block or alter a scheduled run.
    console.warn('Could not record scheduler delivery event.', error);
  }
}
