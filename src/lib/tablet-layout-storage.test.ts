import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CONTEXT_PANEL_MAX_RATIO,
  CONTEXT_PANEL_MIN_RATIO,
  DEFAULT_TABLET_LAYOUT_PREFS,
  loadTabletLayoutPrefs,
  normalizeTabletLayoutPrefs,
  saveTabletLayoutPrefs,
} from './tablet-layout-storage';

vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

const secureStore = vi.hoisted(() => {
  const values = new Map<string, string>();

  return {
    values,
    getItemAsync: vi.fn(async (key: string) => values.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    deleteItemAsync: vi.fn(async (key: string) => {
      values.delete(key);
    }),
  };
});

vi.mock('expo-secure-store', () => secureStore);

type MemoryStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function memoryStorage(): MemoryStorage {
  const values = new Map<string, string>();

  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

describe('tablet layout storage', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: MemoryStorage }).localStorage = memoryStorage();
    secureStore.values.clear();
    vi.clearAllMocks();
  });

  it('uses null defaults and clamps stored panel ratios', () => {
    expect(normalizeTabletLayoutPrefs(null)).toEqual(DEFAULT_TABLET_LAYOUT_PREFS);

    const prefs = normalizeTabletLayoutPrefs({
      sidebarCollapsed: true,
      contextPanelOpen: false,
      contextPanelRatio: 4,
    });

    expect(prefs.sidebarCollapsed).toBe(true);
    expect(prefs.contextPanelOpen).toBe(false);
    expect(prefs.contextPanelRatio).toBe(CONTEXT_PANEL_MAX_RATIO);

    expect(
      normalizeTabletLayoutPrefs({ contextPanelRatio: -1 }).contextPanelRatio
    ).toBe(CONTEXT_PANEL_MIN_RATIO);
    expect(
      normalizeTabletLayoutPrefs({ sidebarCollapsed: 'yes', contextPanelOpen: 'no' })
    ).toEqual(DEFAULT_TABLET_LAYOUT_PREFS);
  });

  it('persists collapse, panel visibility, and resize preferences', async () => {
    const prefs = {
      sidebarCollapsed: true,
      contextPanelOpen: false,
      contextPanelRatio: 0.31,
    };

    await saveTabletLayoutPrefs(prefs);

    expect(await loadTabletLayoutPrefs()).toEqual(prefs);
  });

  it('falls back to defaults for invalid JSON', async () => {
    (globalThis as { localStorage: MemoryStorage }).localStorage.setItem(
      'orbit.tablet-layout.v1',
      'not-json'
    );

    expect(await loadTabletLayoutPrefs()).toEqual(DEFAULT_TABLET_LAYOUT_PREFS);
  });
});
