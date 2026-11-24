/**
 * One cooperative limit for one tool call. The executor owns the timer and
 * passes a single AbortSignal to the tool body; the result is structured so a
 * timed-out call is distinguishable from an ordinary tool failure.
 */

import { executionTimeoutForCategory } from './classifier';
import type { ClassifiedPermissionAction } from './types';

export type ToolFailureCode = 'TOOL_TIMEOUT' | 'TOOL_CANCELLED';

const MIN_TOOL_LIMIT_MS = 1_000;
const MAX_TOOL_LIMIT_MS = 120_000;

export class ToolLimitError extends Error {
  constructor(
    readonly code: ToolFailureCode,
    message: string
  ) {
    super(message);
    this.name = 'ToolLimitError';
  }
}

export function executionLimitFor(
  declared: number | undefined,
  action: ClassifiedPermissionAction
): number {
  const value =
    typeof declared === 'number' && Number.isFinite(declared)
      ? declared
      : executionTimeoutForCategory(action.category);

  return Math.min(Math.max(Math.trunc(value), MIN_TOOL_LIMIT_MS), MAX_TOOL_LIMIT_MS);
}

/**
 * A tool receives `signal` and may stop its own work. The race guarantees a
 * clear result even when the tool ignores cancellation; late results are
 * swallowed so they cannot surface as unhandled rejections.
 */
export function withToolLimit<T>(
  run: (signal: AbortSignal) => Promise<T>,
  limit: { timeoutMs: number; signal?: AbortSignal }
): Promise<T> {
  const controller = new AbortController();
  let rejectAborted: (error: ToolLimitError) => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAborted = reject;
  });

  const cancel = () => {
    const error = new ToolLimitError('TOOL_CANCELLED', 'TOOL_CANCELLED: the tool call was stopped.');
    controller.abort(error);
    rejectAborted(error);
  };

  if (limit.signal?.aborted) {
    // Defer so Promise.race attaches its rejection handler in the same tick.
    Promise.resolve().then(cancel);
  } else {
    limit.signal?.addEventListener('abort', cancel, { once: true });
  }

  const timer = setTimeout(() => {
    const seconds = Math.round(limit.timeoutMs / 1000);
    const error = new ToolLimitError(
      'TOOL_TIMEOUT',
      `TOOL_TIMEOUT: the tool call exceeded ${seconds}s.`
    );
    controller.abort(error);
    rejectAborted(error);
  }, limit.timeoutMs);

  const cleanup = () => {
    clearTimeout(timer);
    limit.signal?.removeEventListener('abort', cancel);
  };

  const work = Promise.resolve().then(() => run(controller.signal));

  void work.catch(() => undefined);

  return Promise.race([work, aborted]).finally(cleanup);
}
