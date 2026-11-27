import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

describe('optional background modules', () => {
  it('degrades safely when native modules are unavailable', async () => {
    vi.resetModules();
    vi.doMock('expo-task-manager', () => {
      throw new Error('native module missing');
    });
    vi.doMock('expo-background-task', () => {
      throw new Error('native module missing');
    });

    const runtime = await import('./background-task-runtime');

    expect(() => runtime.defineRecoveryTask('recovery', async () => true)).not.toThrow();
    await expect(runtime.registerRecoveryTask('recovery', 15)).resolves.toBe(false);
  });
});
