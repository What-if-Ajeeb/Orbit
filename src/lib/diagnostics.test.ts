import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async () => null),
  setItemAsync: vi.fn(async () => undefined),
  deleteItemAsync: vi.fn(async () => undefined),
}));

/**
 * Readiness is module state, so each test gets a fresh copy of the module.
 */
async function loadDiagnostics() {
  vi.resetModules();
  return import('./diagnostics');
}

describe('startup diagnostics', () => {
  it('starts with UI not ready and tracks the last startup stage', async () => {
    const { getStartupStage, isUiReady, markStartupStage } = await loadDiagnostics();

    expect(isUiReady()).toBe(false);
    expect(getStartupStage()).toBe('Bundle loaded');

    markStartupStage('Navigator rendered');
    expect(getStartupStage()).toBe('Navigator rendered');
  });

  it('marks UI ready once and notifies subscribers', async () => {
    const { isUiReady, markUiReady, subscribeUiReady } = await loadDiagnostics();
    const listener = vi.fn();
    const unsubscribe = subscribeUiReady(listener);

    markUiReady();
    markUiReady();

    expect(isUiReady()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('notifies late subscribers immediately and stops after unsubscribe', async () => {
    const { markUiReady, subscribeUiReady } = await loadDiagnostics();
    markUiReady();

    const listener = vi.fn();
    const unsubscribe = subscribeUiReady(listener);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    markUiReady();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
