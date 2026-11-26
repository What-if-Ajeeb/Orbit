import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const PINNED_PLUGINS_KEY = 'orbit.pinned-plugins.v2';
const LEGACY_PINNED_PLUGINS_KEY = 'orbit.pinned-plugins.v1';
export const MAX_PINNED_PLUGINS = 8;
const MAX_PLUGIN_ID_LENGTH = 120;

export const PINNED_PLUGIN_GROUP_IDS = ['everything', 'more'] as const;
export type PinnedPluginGroupId = (typeof PINNED_PLUGIN_GROUP_IDS)[number];

export type PinnedPluginGroup = {
  id: PinnedPluginGroupId;
  pluginIds: string[];
};

export type PinnedPluginsState = {
  groups: PinnedPluginGroup[];
  collapsedGroupIds: PinnedPluginGroupId[];
};

/** Labels are UI-owned so persisted data cannot inject names or routes. */
export const PINNED_PLUGIN_GROUP_LABELS: Record<PinnedPluginGroupId, string> = {
  everything: 'Everything',
  more: 'More Plugins',
};

type WebStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function getWebStorage(): WebStorage | null {
  return (globalThis as { localStorage?: WebStorage }).localStorage ?? null;
}

function normalizePluginId(candidate: unknown): string | null {
  if (
    typeof candidate !== 'string' ||
    !candidate.trim() ||
    candidate.length > MAX_PLUGIN_ID_LENGTH ||
    /\s/.test(candidate)
  ) {
    return null;
  }

  return candidate;
}

function normalizeGroupId(candidate: unknown): PinnedPluginGroupId | null {
  return PINNED_PLUGIN_GROUP_IDS.find((id) => id === candidate) ?? null;
}

export function createEmptyPinnedPluginsState(): PinnedPluginsState {
  return {
    groups: PINNED_PLUGIN_GROUP_IDS.map((id) => ({ id, pluginIds: [] })),
    collapsedGroupIds: [],
  };
}

export function getPinnedPluginIds(state: PinnedPluginsState): string[] {
  return state.groups.flatMap((group) => group.pluginIds);
}

/**
 * Only stable plugin IDs and group IDs are stored. The sidebar resolves labels,
 * icons and routes from the live plugin snapshot, so a manifest rename cannot
 * inject a URL, and old flat lists migrate into the primary group.
 */
export function normalizePinnedPlugins(value: unknown): PinnedPluginsState {
  const state = createEmptyPinnedPluginsState();
  const groupsById = new Map(state.groups.map((group) => [group.id, group]));
  const seen = new Set<string>();
  const collapsed = new Set<PinnedPluginGroupId>();

  const addPlugin = (groupId: PinnedPluginGroupId, candidate: unknown) => {
    if (seen.size >= MAX_PINNED_PLUGINS) {
      return;
    }

    const pluginId = normalizePluginId(candidate);

    if (!pluginId || seen.has(pluginId)) {
      return;
    }

    seen.add(pluginId);
    groupsById.get(groupId)?.pluginIds.push(pluginId);
  };

  if (Array.isArray(value)) {
    for (const pluginId of value) {
      addPlugin('everything', pluginId);
    }
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;

    if (Array.isArray(record.groups)) {
      for (const rawGroup of record.groups) {
        if (!rawGroup || typeof rawGroup !== 'object') {
          continue;
        }

        const group = rawGroup as Record<string, unknown>;
        const groupId = normalizeGroupId(group.id);

        if (!groupId || !Array.isArray(group.pluginIds)) {
          continue;
        }

        for (const pluginId of group.pluginIds) {
          addPlugin(groupId, pluginId);
        }
      }
    } else if (Array.isArray(record.pinnedIds)) {
      for (const pluginId of record.pinnedIds) {
        addPlugin('everything', pluginId);
      }
    }

    if (Array.isArray(record.collapsedGroupIds)) {
      for (const candidate of record.collapsedGroupIds) {
        const groupId = normalizeGroupId(candidate);

        if (groupId) {
          collapsed.add(groupId);
        }
      }
    }
  }

  state.collapsedGroupIds = PINNED_PLUGIN_GROUP_IDS.filter((id) => collapsed.has(id));
  return state;
}

export function normalizePinnedPluginIds(value: unknown): string[] {
  return getPinnedPluginIds(normalizePinnedPlugins(value));
}

export function addPinnedPlugin(
  state: PinnedPluginsState,
  pluginId: string,
  groupId: PinnedPluginGroupId = 'everything'
): PinnedPluginsState {
  const normalizedId = normalizePluginId(pluginId);
  const targetGroupId = normalizeGroupId(groupId) ?? 'everything';

  if (!normalizedId || getPinnedPluginIds(state).includes(normalizedId)) {
    return state;
  }

  if (getPinnedPluginIds(state).length >= MAX_PINNED_PLUGINS) {
    return state;
  }

  return {
    ...state,
    groups: state.groups.map((group) =>
      group.id === targetGroupId
        ? { ...group, pluginIds: [...group.pluginIds, normalizedId] }
        : group
    ),
  };
}

export function removePinnedPlugin(
  state: PinnedPluginsState,
  pluginId: string
): PinnedPluginsState {
  if (!getPinnedPluginIds(state).includes(pluginId)) {
    return state;
  }

  return {
    ...state,
    groups: state.groups.map((group) => ({
      ...group,
      pluginIds: group.pluginIds.filter((id) => id !== pluginId),
    })),
  };
}

export function movePinnedPlugin(
  state: PinnedPluginsState,
  pluginId: string,
  targetGroupId: PinnedPluginGroupId,
  targetIndex: number
): PinnedPluginsState {
  const targetId = normalizeGroupId(targetGroupId);

  if (!targetId) {
    return state;
  }

  const groups = state.groups.map((group) => ({
    ...group,
    pluginIds: [...group.pluginIds],
  }));
  const sourceGroup = groups.find((group) => group.pluginIds.includes(pluginId));
  const targetGroup = groups.find((group) => group.id === targetId);

  if (!sourceGroup || !targetGroup) {
    return state;
  }

  const sourceIndex = sourceGroup.pluginIds.indexOf(pluginId);
  sourceGroup.pluginIds.splice(sourceIndex, 1);

  const index = Number.isFinite(targetIndex)
    ? Math.trunc(targetIndex)
    : targetGroup.pluginIds.length;
  const insertAt = Math.max(0, Math.min(targetGroup.pluginIds.length, index));

  if (sourceGroup === targetGroup && sourceIndex === insertAt) {
    return state;
  }

  targetGroup.pluginIds.splice(insertAt, 0, pluginId);
  return { ...state, groups };
}

export function setPinnedGroupExpanded(
  state: PinnedPluginsState,
  groupId: PinnedPluginGroupId,
  expanded: boolean
): PinnedPluginsState {
  const targetId = normalizeGroupId(groupId);

  if (!targetId) {
    return state;
  }

  const collapsed = state.collapsedGroupIds.includes(targetId);

  if (expanded !== collapsed) {
    return state;
  }

  return {
    ...state,
    collapsedGroupIds: expanded
      ? state.collapsedGroupIds.filter((id) => id !== targetId)
      : [...state.collapsedGroupIds, targetId],
  };
}

async function readStoredValue(key: string): Promise<string | null> {
  try {
    return Platform.OS === 'web'
      ? getWebStorage()?.getItem(key) ?? null
      : await SecureStore.getItemAsync(key);
  } catch (error) {
    console.warn('Could not read pinned plugins.', error);
    return null;
  }
}

export async function loadPinnedPlugins(): Promise<PinnedPluginsState> {
  for (const key of [PINNED_PLUGINS_KEY, LEGACY_PINNED_PLUGINS_KEY]) {
    const raw = await readStoredValue(key);

    if (!raw) {
      continue;
    }

    try {
      return normalizePinnedPlugins(JSON.parse(raw));
    } catch (error) {
      console.warn('Could not parse pinned plugins.', error);
    }
  }

  return createEmptyPinnedPluginsState();
}

export async function savePinnedPlugins(state: PinnedPluginsState): Promise<void> {
  const normalized = normalizePinnedPlugins(state);
  const raw = JSON.stringify({ version: 2, ...normalized });

  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(PINNED_PLUGINS_KEY, raw);
    return;
  }

  await SecureStore.setItemAsync(PINNED_PLUGINS_KEY, raw);
}

/** Backwards-compatible ID-only helpers for callers outside the sidebar tree. */
export async function loadPinnedPluginIds(): Promise<string[]> {
  return getPinnedPluginIds(await loadPinnedPlugins());
}

export async function savePinnedPluginIds(ids: readonly string[]): Promise<void> {
  await savePinnedPlugins(
    normalizePinnedPlugins({
      groups: [{ id: 'everything', pluginIds: ids }],
      collapsedGroupIds: [],
    })
  );
}
