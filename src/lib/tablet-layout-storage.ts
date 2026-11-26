import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TABLET_LAYOUT_KEY = 'orbit.tablet-layout.v1';

export const CONTEXT_PANEL_MIN_RATIO = 0.2;
export const CONTEXT_PANEL_MAX_RATIO = 0.38;
export const DEFAULT_CONTEXT_PANEL_RATIO = 0.28;

export type TabletLayoutPrefs = {
  /** null means "follow the breakpoint default" for the current orientation. */
  sidebarCollapsed: boolean | null;
  contextPanelOpen: boolean | null;
  contextPanelRatio: number;
};

export const DEFAULT_TABLET_LAYOUT_PREFS: TabletLayoutPrefs = {
  sidebarCollapsed: null,
  contextPanelOpen: null,
  contextPanelRatio: DEFAULT_CONTEXT_PANEL_RATIO,
};

type WebStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function getWebStorage(): WebStorage | null {
  return (globalThis as { localStorage?: WebStorage }).localStorage ?? null;
}

function optionalBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

export function normalizeTabletLayoutPrefs(value: unknown): TabletLayoutPrefs {
  const raw = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const ratio =
    typeof raw.contextPanelRatio === 'number' && Number.isFinite(raw.contextPanelRatio)
      ? raw.contextPanelRatio
      : DEFAULT_CONTEXT_PANEL_RATIO;

  return {
    sidebarCollapsed: optionalBoolean(raw.sidebarCollapsed),
    contextPanelOpen: optionalBoolean(raw.contextPanelOpen),
    contextPanelRatio: Math.min(
      CONTEXT_PANEL_MAX_RATIO,
      Math.max(CONTEXT_PANEL_MIN_RATIO, ratio)
    ),
  };
}

export async function loadTabletLayoutPrefs(): Promise<TabletLayoutPrefs> {
  try {
    const raw =
      Platform.OS === 'web'
        ? getWebStorage()?.getItem(TABLET_LAYOUT_KEY) ?? null
        : await SecureStore.getItemAsync(TABLET_LAYOUT_KEY);

    return normalizeTabletLayoutPrefs(raw ? JSON.parse(raw) : null);
  } catch (error) {
    console.warn('Could not load tablet layout preferences.', error);
    return { ...DEFAULT_TABLET_LAYOUT_PREFS };
  }
}

export async function saveTabletLayoutPrefs(prefs: TabletLayoutPrefs): Promise<void> {
  const normalized = normalizeTabletLayoutPrefs(prefs);
  const raw = JSON.stringify(normalized);

  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(TABLET_LAYOUT_KEY, raw);
    return;
  }

  await SecureStore.setItemAsync(TABLET_LAYOUT_KEY, raw);
}
