import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  addPinnedPlugin,
  createEmptyPinnedPluginsState,
  getPinnedPluginIds,
  loadPinnedPlugins,
  movePinnedPlugin as movePinnedPluginInState,
  removePinnedPlugin,
  savePinnedPlugins,
  setPinnedGroupExpanded,
  type PinnedPluginGroup,
  type PinnedPluginGroupId,
  type PinnedPluginsState,
} from '@/lib/pinned-plugins';

type PinnedPluginsContextValue = {
  state: PinnedPluginsState;
  pinnedIds: readonly string[];
  groups: readonly PinnedPluginGroup[];
  collapsedGroupIds: readonly PinnedPluginGroupId[];
  ready: boolean;
  isPinned: (pluginId: string) => boolean;
  togglePin: (pluginId: string, groupId?: PinnedPluginGroupId) => void;
  setPinned: (pluginId: string, pinned: boolean, groupId?: PinnedPluginGroupId) => void;
  pinPlugin: (pluginId: string, groupId?: PinnedPluginGroupId) => void;
  unpinPlugin: (pluginId: string) => void;
  movePinnedPlugin: (
    pluginId: string,
    groupId: PinnedPluginGroupId,
    targetIndex: number
  ) => void;
  movePinnedPluginToGroup: (pluginId: string, groupId: PinnedPluginGroupId) => void;
  setGroupExpanded: (groupId: PinnedPluginGroupId, expanded: boolean) => void;
  toggleGroup: (groupId: PinnedPluginGroupId) => void;
};

const PinnedPluginsContext = createContext<PinnedPluginsContextValue | null>(null);

const EMPTY_STATE = createEmptyPinnedPluginsState();
const EMPTY_IDS: readonly string[] = [];
const EMPTY_GROUPS: readonly PinnedPluginGroup[] = EMPTY_STATE.groups;
const EMPTY_COLLAPSED: readonly PinnedPluginGroupId[] = EMPTY_STATE.collapsedGroupIds;

const FALLBACK_VALUE: PinnedPluginsContextValue = {
  state: EMPTY_STATE,
  pinnedIds: EMPTY_IDS,
  groups: EMPTY_GROUPS,
  collapsedGroupIds: EMPTY_COLLAPSED,
  ready: true,
  isPinned: () => false,
  togglePin: () => undefined,
  setPinned: () => undefined,
  pinPlugin: () => undefined,
  unpinPlugin: () => undefined,
  movePinnedPlugin: () => undefined,
  movePinnedPluginToGroup: () => undefined,
  setGroupExpanded: () => undefined,
  toggleGroup: () => undefined,
};

export function PinnedPluginsProvider({ children }: PropsWithChildren) {
  const [state, setState] = useState<PinnedPluginsState>(createEmptyPinnedPluginsState);
  const [ready, setReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;

    void loadPinnedPlugins()
      .then((stored) => {
        if (active) {
          setState(stored);
          setReady(true);
          setHydrated(true);
        }
      })
      .catch(() => {
        if (active) {
          // Keep the pins usable in memory, but do not overwrite storage with
          // an empty list after a transient read failure.
          setReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) {
      return;
    }

    void savePinnedPlugins(state).catch(() => {
      // Pinned plugins remain usable in memory if device storage is unavailable.
    });
  }, [hydrated, state]);

  const pinnedIds = useMemo(() => getPinnedPluginIds(state), [state]);

  const isPinned = useCallback(
    (pluginId: string) => pinnedIds.includes(pluginId),
    [pinnedIds]
  );

  const setPinned = useCallback(
    (pluginId: string, pinned: boolean, groupId: PinnedPluginGroupId = 'everything') => {
      if (!pluginId) {
        return;
      }

      setState((current) =>
        pinned
          ? addPinnedPlugin(current, pluginId, groupId)
          : removePinnedPlugin(current, pluginId)
      );
    },
    []
  );

  const pinPlugin = useCallback(
    (pluginId: string, groupId: PinnedPluginGroupId = 'everything') => {
      setPinned(pluginId, true, groupId);
    },
    [setPinned]
  );

  const unpinPlugin = useCallback((pluginId: string) => {
    setState((current) => removePinnedPlugin(current, pluginId));
  }, []);

  const togglePin = useCallback(
    (pluginId: string, groupId: PinnedPluginGroupId = 'everything') => {
      setPinned(pluginId, !isPinned(pluginId), groupId);
    },
    [isPinned, setPinned]
  );

  const movePinnedPlugin = useCallback(
    (pluginId: string, groupId: PinnedPluginGroupId, targetIndex: number) => {
      setState((current) => movePinnedPluginInState(current, pluginId, groupId, targetIndex));
    },
    []
  );

  const movePinnedPluginToGroup = useCallback(
    (pluginId: string, groupId: PinnedPluginGroupId) => {
      setState((current) => {
        const group = current.groups.find((item) => item.id === groupId);
        return movePinnedPluginInState(
          current,
          pluginId,
          groupId,
          group?.pluginIds.length ?? 0
        );
      });
    },
    []
  );

  const setGroupExpanded = useCallback(
    (groupId: PinnedPluginGroupId, expanded: boolean) => {
      setState((current) => setPinnedGroupExpanded(current, groupId, expanded));
    },
    []
  );

  const toggleGroup = useCallback((groupId: PinnedPluginGroupId) => {
    setState((current) =>
      setPinnedGroupExpanded(current, groupId, current.collapsedGroupIds.includes(groupId))
    );
  }, []);

  const value = useMemo(
    () => ({
      state,
      pinnedIds,
      groups: state.groups,
      collapsedGroupIds: state.collapsedGroupIds,
      ready,
      isPinned,
      togglePin,
      setPinned,
      pinPlugin,
      unpinPlugin,
      movePinnedPlugin,
      movePinnedPluginToGroup,
      setGroupExpanded,
      toggleGroup,
    }),
    [
      isPinned,
      movePinnedPlugin,
      movePinnedPluginToGroup,
      pinPlugin,
      pinnedIds,
      ready,
      setGroupExpanded,
      setPinned,
      state,
      toggleGroup,
      togglePin,
      unpinPlugin,
    ]
  );

  return (
    <PinnedPluginsContext.Provider value={value}>
      {children}
    </PinnedPluginsContext.Provider>
  );
}

/**
 * Falls back to inert defaults so shared components stay renderable in isolated
 * tests and outside the authenticated app shell.
 */
export function usePinnedPlugins(): PinnedPluginsContextValue {
  return useContext(PinnedPluginsContext) ?? FALLBACK_VALUE;
}
