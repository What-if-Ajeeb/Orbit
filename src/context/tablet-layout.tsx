import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import { useResponsiveLayout, type ResponsiveLayoutState } from '@/hooks/useResponsiveLayout';
import { resolveResponsiveLayout } from '@/lib/responsive';
import {
  CONTEXT_PANEL_MAX_RATIO,
  CONTEXT_PANEL_MIN_RATIO,
  DEFAULT_TABLET_LAYOUT_PREFS,
  loadTabletLayoutPrefs,
  saveTabletLayoutPrefs,
  type TabletLayoutPrefs,
} from '@/lib/tablet-layout-storage';

export type TabletLayoutContextValue = {
  layout: ResponsiveLayoutState;
  sidebarCollapsed: boolean;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  contextPanelOpen: boolean;
  setContextPanelOpen: (open: boolean) => void;
  toggleContextPanel: () => void;
  contextPanelWidth: number;
  setContextPanelWidth: (width: number) => void;
};

const TabletLayoutContext = createContext<TabletLayoutContextValue | null>(null);

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function panelWidthForRatio(width: number, ratio: number): number {
  if (!Number.isFinite(width) || width <= 0) {
    return 320;
  }

  const min = Math.min(300, Math.max(220, width * CONTEXT_PANEL_MIN_RATIO));
  const max = Math.min(420, Math.max(min, width * CONTEXT_PANEL_MAX_RATIO));
  return Math.round(clamp(width * ratio, min, max));
}

const FALLBACK_LAYOUT: ResponsiveLayoutState = {
  ...resolveResponsiveLayout(390, 844),
  width: 390,
  height: 844,
  layoutWidth: 390,
  layoutHeight: 844,
  keyboardVisible: false,
};

/**
 * Inert defaults for shared components rendered outside the authenticated shell.
 * The fallback is phone-shaped so phone behavior stays unchanged in isolation.
 */
const FALLBACK_VALUE: TabletLayoutContextValue = {
  layout: FALLBACK_LAYOUT,
  sidebarCollapsed: false,
  setSidebarCollapsed: () => undefined,
  toggleSidebar: () => undefined,
  contextPanelOpen: false,
  setContextPanelOpen: () => undefined,
  toggleContextPanel: () => undefined,
  contextPanelWidth: panelWidthForRatio(
    FALLBACK_LAYOUT.width,
    DEFAULT_TABLET_LAYOUT_PREFS.contextPanelRatio
  ),
  setContextPanelWidth: () => undefined,
};

export function TabletLayoutProvider({ children }: PropsWithChildren) {
  const layout = useResponsiveLayout();
  const [prefs, setPrefs] = useState<TabletLayoutPrefs>({ ...DEFAULT_TABLET_LAYOUT_PREFS });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    void loadTabletLayoutPrefs()
      .then((stored) => {
        if (active) {
          setPrefs(stored);
          setLoaded(true);
        }
      })
      .catch(() => {
        // Keep safe defaults in memory, but do not overwrite stored preferences
        // after a transient read failure.
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!loaded) {
      return;
    }

    void saveTabletLayoutPrefs(prefs).catch(() => {
      // Layout preferences remain usable in memory if device storage is unavailable.
    });
  }, [loaded, prefs]);

  const updatePrefs = useCallback((patch: Partial<TabletLayoutPrefs>) => {
    setPrefs((current) => ({ ...current, ...patch }));
  }, []);

  const sidebarCollapsed =
    prefs.sidebarCollapsed ?? layout.mode === 'tablet-landscape-compact';
  const contextPanelOpen =
    layout.contextPanelAvailable && (prefs.contextPanelOpen ?? true);
  const contextPanelWidth = panelWidthForRatio(
    layout.width,
    prefs.contextPanelRatio
  );

  const setSidebarCollapsed = useCallback(
    (collapsed: boolean) => updatePrefs({ sidebarCollapsed: collapsed }),
    [updatePrefs]
  );

  const toggleSidebar = useCallback(
    () => setSidebarCollapsed(!sidebarCollapsed),
    [setSidebarCollapsed, sidebarCollapsed]
  );

  const setContextPanelOpen = useCallback(
    (open: boolean) => updatePrefs({ contextPanelOpen: open }),
    [updatePrefs]
  );

  const toggleContextPanel = useCallback(
    () => setContextPanelOpen(!contextPanelOpen),
    [contextPanelOpen, setContextPanelOpen]
  );

  const setContextPanelWidth = useCallback(
    (width: number) => {
      if (!Number.isFinite(layout.width) || layout.width <= 0) {
        return;
      }

      const ratio = clamp(width / layout.width, CONTEXT_PANEL_MIN_RATIO, CONTEXT_PANEL_MAX_RATIO);
      updatePrefs({ contextPanelRatio: ratio });
    },
    [layout.width, updatePrefs]
  );

  const value = useMemo(
    () => ({
      layout,
      sidebarCollapsed,
      setSidebarCollapsed,
      toggleSidebar,
      contextPanelOpen,
      setContextPanelOpen,
      toggleContextPanel,
      contextPanelWidth,
      setContextPanelWidth,
    }),
    [
      contextPanelOpen,
      contextPanelWidth,
      layout,
      setContextPanelOpen,
      setContextPanelWidth,
      setSidebarCollapsed,
      sidebarCollapsed,
      toggleContextPanel,
      toggleSidebar,
    ]
  );

  return (
    <TabletLayoutContext.Provider value={value}>
      {children}
    </TabletLayoutContext.Provider>
  );
}

/** Returns the shell context, or inert defaults outside the authenticated shell. */
export function useTabletLayout(): TabletLayoutContextValue {
  return useContext(TabletLayoutContext) ?? FALLBACK_VALUE;
}
