import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addPinnedPlugin,
  createEmptyPinnedPluginsState,
  getPinnedPluginIds,
  loadPinnedPluginIds,
  loadPinnedPlugins,
  MAX_PINNED_PLUGINS,
  movePinnedPlugin,
  normalizePinnedPluginIds,
  normalizePinnedPlugins,
  removePinnedPlugin,
  savePinnedPluginIds,
  savePinnedPlugins,
  setPinnedGroupExpanded,
} from './pinned-plugins';

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

describe('pinned plugin storage', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: MemoryStorage }).localStorage = memoryStorage();
    secureStore.values.clear();
    vi.clearAllMocks();
  });

  it('normalizes malformed values, removes duplicates, and caps the list', () => {
    const ids = Array.from({ length: MAX_PINNED_PLUGINS + 3 }, (_, index) => `plugin:${index}`);

    expect(
      normalizePinnedPluginIds([
        ...ids,
        'plugin:0',
        '',
        '   ',
        12,
        'has space',
        'x'.repeat(121),
      ])
    ).toEqual(ids.slice(0, MAX_PINNED_PLUGINS));
    expect(normalizePinnedPluginIds(null)).toEqual([]);
  });

  it('preserves group order, group membership and collapsed groups', () => {
    const state = normalizePinnedPlugins({
      groups: [
        {
          id: 'everything',
          pluginIds: ['calendar', 'diagnostics'],
          label: 'Injected label',
          href: 'javascript:alert(1)',
        },
        { id: 'more', pluginIds: ['notes', 'calendar'] },
        { id: 'unknown', pluginIds: ['ignored'] },
      ],
      collapsedGroupIds: ['more', 'unknown'],
    });

    expect(state.groups).toEqual([
      { id: 'everything', pluginIds: ['calendar', 'diagnostics'] },
      { id: 'more', pluginIds: ['notes'] },
    ]);
    expect(state.collapsedGroupIds).toEqual(['more']);
  });

  it('persists grouped plugins and collapse state across loads', async () => {
    const state = normalizePinnedPlugins({
      groups: [
        { id: 'everything', pluginIds: ['calendar'] },
        { id: 'more', pluginIds: ['notes', 'calendar'] },
      ],
      collapsedGroupIds: ['more'],
    });

    await savePinnedPlugins(state);

    expect(await loadPinnedPlugins()).toEqual(state);
  });

  it('migrates flat legacy IDs into the primary group', async () => {
    (globalThis as { localStorage: MemoryStorage }).localStorage.setItem(
      'orbit.pinned-plugins.v1',
      JSON.stringify(['calendar', 'notes'])
    );

    const state = await loadPinnedPlugins();

    expect(state.groups).toEqual([
      { id: 'everything', pluginIds: ['calendar', 'notes'] },
      { id: 'more', pluginIds: [] },
    ]);
    expect(state.collapsedGroupIds).toEqual([]);
  });

  it('falls back to legacy storage when the current value is corrupt', async () => {
    const storage = (globalThis as { localStorage: MemoryStorage }).localStorage;

    storage.setItem('orbit.pinned-plugins.v2', '{not-json');
    storage.setItem('orbit.pinned-plugins.v1', JSON.stringify(['calendar']));

    expect(getPinnedPluginIds(await loadPinnedPlugins())).toEqual(['calendar']);
  });

  it('recovers from corrupt stored data', async () => {
    (globalThis as { localStorage: MemoryStorage }).localStorage.setItem(
      'orbit.pinned-plugins.v2',
      '{not-json'
    );

    expect(getPinnedPluginIds(await loadPinnedPlugins())).toEqual([]);
  });

  it('keeps ID-only saves readable through the grouped loader', async () => {
    await savePinnedPluginIds(['calendar', 'notes', 'calendar']);

    expect(await loadPinnedPluginIds()).toEqual(['calendar', 'notes']);
  });
});

describe('pinned plugin tree operations', () => {
  const state = () =>
    normalizePinnedPlugins({
      groups: [
        { id: 'everything', pluginIds: ['calendar', 'notes'] },
        { id: 'more', pluginIds: ['diagnostics'] },
      ],
      collapsedGroupIds: [],
    });

  it('never adds a plugin twice, even across groups', () => {
    expect(addPinnedPlugin(state(), 'calendar', 'more')).toEqual(state());
    expect(addPinnedPlugin(state(), 'new-plugin', 'more').groups[1].pluginIds).toEqual([
      'diagnostics',
      'new-plugin',
    ]);
  });

  it('removes a plugin from whichever group contains it', () => {
    expect(getPinnedPluginIds(removePinnedPlugin(state(), 'diagnostics'))).toEqual([
      'calendar',
      'notes',
    ]);
  });

  it('reorders within a group and clamps the target index', () => {
    expect(movePinnedPlugin(state(), 'calendar', 'everything', 1).groups[0].pluginIds).toEqual([
      'notes',
      'calendar',
    ]);
    expect(movePinnedPlugin(state(), 'notes', 'everything', 99).groups[0].pluginIds).toEqual([
      'calendar',
      'notes',
    ]);
  });

  it('moves a plugin between groups without duplicating it', () => {
    const moved = movePinnedPlugin(state(), 'notes', 'more', 0);

    expect(moved.groups[0].pluginIds).toEqual(['calendar']);
    expect(moved.groups[1].pluginIds).toEqual(['notes', 'diagnostics']);
  });

  it('stores expanded and collapsed group state', () => {
    const collapsed = setPinnedGroupExpanded(state(), 'more', false);

    expect(collapsed.collapsedGroupIds).toEqual(['more']);
    expect(setPinnedGroupExpanded(collapsed, 'more', true).collapsedGroupIds).toEqual([]);
    expect(createEmptyPinnedPluginsState().groups).toEqual([
      { id: 'everything', pluginIds: [] },
      { id: 'more', pluginIds: [] },
    ]);
  });
});
