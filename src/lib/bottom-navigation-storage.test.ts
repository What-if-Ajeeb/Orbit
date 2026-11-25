import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearBottomNavIds,
  loadBottomNavIds,
  normalizeStoredNavIds,
  saveBottomNavIds,
} from './bottom-navigation-storage';

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

function setWebStorage(storage: MemoryStorage): void {
  (globalThis as { localStorage?: MemoryStorage }).localStorage = storage;
}

describe('bottom navigation storage', () => {
  beforeEach(() => {
    setWebStorage(memoryStorage());
    secureStore.values.clear();
    vi.clearAllMocks();
  });

  it('normalizes malformed stored values to exactly three unique IDs', () => {
    expect(
      normalizeStoredNavIds(['chat', 'chat', '', 'tasks', 42, 'plugin:a:b'])
    ).toEqual(['chat', 'tasks', 'plugin:a:b']);
    expect(normalizeStoredNavIds(null)).toEqual(['chat', 'tasks', 'make']);
  });

  it('persists, loads, and restores defaults', async () => {
    const saved = await saveBottomNavIds(['buddy', 'chat', 'buddy', 'projects']);

    expect(saved).toEqual(['buddy', 'chat', 'projects']);
    expect(await loadBottomNavIds()).toEqual(saved);

    await clearBottomNavIds();
    expect(await loadBottomNavIds()).toEqual(['chat', 'tasks', 'make']);
  });
});
