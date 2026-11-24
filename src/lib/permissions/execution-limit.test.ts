import { afterEach, describe, expect, it, vi } from 'vitest';

import { executionLimitFor, ToolLimitError, withToolLimit } from './execution-limit';
import type { ClassifiedPermissionAction } from './types';

afterEach(() => {
  vi.useRealTimers();
});

describe('cooperative tool limit', () => {
  it('returns a fast tool result unchanged', async () => {
    const result = await withToolLimit(async () => ({ content: 'ok', trace: 'done' }), {
      timeoutMs: 1_000,
    });

    expect(result).toEqual({ content: 'ok', trace: 'done' });
  });

  it('returns TOOL_TIMEOUT and aborts the tool body when the timer wins', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const outcome = withToolLimit(
      async (signal) => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        return new Promise<string>(() => undefined);
      },
      { timeoutMs: 1_000 }
    );

    const assertion = expect(outcome).rejects.toMatchObject({
      name: 'ToolLimitError',
      code: 'TOOL_TIMEOUT',
      message: expect.stringContaining('TOOL_TIMEOUT'),
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(aborted).toBe(true);
  });

  it('stops immediately when an external signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      withToolLimit(async () => 'late', {
        timeoutMs: 1_000,
        signal: controller.signal,
      })
    ).rejects.toBeInstanceOf(ToolLimitError);
  });

  it('clamps declared limits and uses the category default', () => {
    const action = { category: 'terminal_commands' } as ClassifiedPermissionAction;

    expect(executionLimitFor(undefined, action)).toBe(60_000);
    expect(executionLimitFor(5, action)).toBe(1_000);
    expect(executionLimitFor(999_999, action)).toBe(120_000);
  });
});
