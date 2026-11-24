export class TimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms.`);
    this.name = 'TimeoutError';
  }
}

export class CancelledError extends Error {
  constructor(label: string) {
    super(`${label} was cancelled.`);
    this.name = 'CancelledError';
  }
}

/**
 * Runs a promise with a hard timeout and optional external abort signal. The
 * timeout always rejects, even when the underlying promise ignores aborts, so
 * a faulty plugin cannot block the caller forever.
 */
export function withTimeout<T>(
  task: Promise<T> | (() => Promise<T>),
  timeoutMs: number,
  label = 'Operation',
  signal?: AbortSignal
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (fn: () => void): void => {
      if (settled) {
        return;
      }

      settled = true;

      if (timer) {
        clearTimeout(timer);
      }

      signal?.removeEventListener('abort', onAbort);
      fn();
    };

    const onAbort = (): void => {
      finish(() => reject(new CancelledError(label)));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => {
      finish(() => reject(new TimeoutError(label, timeoutMs)));
    }, timeoutMs);

    let promise: Promise<T>;

    try {
      promise = typeof task === 'function' ? task() : task;
    } catch (error) {
      finish(() => reject(error));
      return;
    }

    promise.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error))
    );
  });
}

export function errorMessage(error: unknown, fallback = 'Unknown error'): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return fallback;
}
