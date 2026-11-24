import { describe, expect, it, vi } from 'vitest';

import { PluginEventBus, sanitizeEventPayload } from '../events';

describe('plugin event bus', () => {
  it('sanitizes secrets, oversized strings and unsupported values', () => {
    const payload = sanitizeEventPayload({
      title: 'ok',
      apiKey: 'super-secret',
      nested: { password: 'hunter2', safe: true },
      text: 'x'.repeat(2_100),
      list: Array.from({ length: 120 }, (_, index) => index),
      callback: () => undefined,
    }) as Record<string, unknown>;

    expect(payload.title).toBe('ok');
    expect(payload.apiKey).toBe('[redacted]');
    expect(payload.nested).toEqual({ password: '[redacted]', safe: true });
    expect(String(payload.text)).toHaveLength(2_001);
    expect((payload.list as unknown[]).length).toBe(100);
    expect(payload.callback).toBe('[unsupported]');

    let nested = sanitizeEventPayload({
      deep: { deep: { deep: { deep: { deep: { deep: { deep: {} } } } } } },
    }) as Record<string, unknown>;
    for (let depth = 0; depth < 6; depth += 1) {
      expect(Object.keys(nested)).toEqual(['deep']);
      nested = nested.deep as Record<string, unknown>;
    }
    expect(nested.deep).toBe('[depth-limited]');
  });

  it('dispatches only matching events with origin and timestamp', () => {
    const bus = new PluginEventBus(() => 42);
    const received: string[] = [];
    bus.subscribe('plugin.a', 'task.created', (event) => {
      received.push(`${event.name}:${event.payload.title}:${event.origin}:${event.timestamp}`);
    });
    bus.subscribe('plugin.b', 'task.completed', () => {
      received.push('wrong-event');
    });

    const payload = { taskId: 7, title: 'Write tests', apiKey: 'secret-value' };
    const event = bus.emit('task.created', payload, 'plugin.a');

    expect(received).toEqual(['task.created:Write tests:plugin.a:42']);
    expect(event.origin).toBe('plugin.a');
    expect(event.timestamp).toBe(42);
    expect((event.payload as unknown as Record<string, unknown>).apiKey).toBe('[redacted]');
  });

  it('unsubscribes, clears one plugin and clears the whole bus', () => {
    const bus = new PluginEventBus();
    const seen: string[] = [];
    const unsubscribe = bus.subscribe('plugin.a', 'task.created', () => {
      seen.push('a');
    });
    bus.subscribe('plugin.b', 'task.created', () => {
      seen.push('b');
    });

    expect(bus.listenerCount()).toBe(2);
    expect(bus.listenersFor('task.created')).toEqual(['plugin.a', 'plugin.b']);
    unsubscribe();
    bus.emit('task.created', { taskId: 1, title: 'one' });
    expect(seen).toEqual(['b']);

    bus.clearPlugin('plugin.b');
    expect(bus.listenerCount()).toBe(0);
    bus.subscribe('plugin.a', 'task.created', () => undefined);
    bus.clear();
    expect(bus.listenerCount()).toBe(0);
  });

  it('enforces a per-plugin listener limit', () => {
    const bus = new PluginEventBus();
    const disposers = Array.from({ length: 50 }, () =>
      bus.subscribe('plugin.a', 'task.created', () => undefined)
    );

    expect(bus.listenerCount('plugin.a')).toBe(50);
    expect(() =>
      bus.subscribe('plugin.a', 'task.created', () => undefined)
    ).toThrow(/50-listener limit/);

    disposers.forEach((dispose) => dispose());
    expect(bus.listenerCount('plugin.a')).toBe(0);
  });

  it('routes synchronous and asynchronous handler failures to the error hook', async () => {
    const onError = vi.fn();
    const bus = new PluginEventBus(() => 1, onError);
    bus.subscribe('plugin.a', 'task.created', () => {
      throw new Error('sync failure');
    });
    bus.subscribe('plugin.b', 'task.created', async () => {
      throw new Error('async failure');
    });

    bus.emit('task.created', { taskId: 1, title: 'boom' });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(2));
    expect(onError.mock.calls.map(([error]) => (error as Error).message)).toEqual([
      'sync failure',
      'async failure',
    ]);
  });

  it('drops recursive event chains instead of recursing forever', () => {
    const onError = vi.fn();
    const bus = new PluginEventBus(() => 1, onError);
    let calls = 0;

    bus.subscribe('plugin.a', 'task.created', () => {
      calls += 1;
      bus.emit('task.created', { taskId: calls, title: 'again' });
    });

    bus.emit('task.created', { taskId: 0, title: 'start' });

    expect(calls).toBe(8);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0][0] as Error).message).toMatch(/recursion guard/);

    calls = 0;
    onError.mockClear();
    bus.emit('task.created', { taskId: 0, title: 'start again' });
    expect(calls).toBe(8);
  });
});
