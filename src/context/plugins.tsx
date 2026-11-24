import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { Platform } from 'react-native';

import {
  getPluginPlatform,
  initializePluginPlatform,
  type PluginPlatformRuntime,
  type PluginPlatformSnapshot,
} from '@/lib/plugins/platform';
import type { PluginPlatform } from '@/lib/plugins/types';

type PluginPlatformContextValue = {
  platform: PluginPlatformRuntime;
  error: string | null;
};

const PluginPlatformContext =
  createContext<PluginPlatformContextValue | null>(null);

function platformName(): PluginPlatform {
  return Platform.OS === 'ios' || Platform.OS === 'android' || Platform.OS === 'web'
    ? Platform.OS
    : 'android';
}

const EMPTY_SNAPSHOT: PluginPlatformSnapshot = {
  version: 0,
  ready: false,
  error: null,
  summaries: [],
  stats: {
    total: 0,
    installed: 0,
    running: 0,
    enabled: 0,
    disabled: 0,
    available: 0,
    errors: 0,
    updates: 0,
    bootstrapMs: null,
    lastBootstrapError: null,
  },
  navigation: [],
  widgets: [],
  settingsSections: [],
  corePluginIds: [],
};

const subscribeToNothing = () => () => {};
const getEmptySnapshot = () => EMPTY_SNAPSHOT;

/**
 * Boots the plugin platform once per database and exposes it to the app.
 * The provider never blocks rendering: contribution hooks return empty lists
 * until bootstrap finishes, then re-render through useSyncExternalStore.
 */
export function PluginPlatformProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const [error, setError] = useState<string | null>(null);
  const [platform] = useState(() =>
    initializePluginPlatform({
      db,
      platform: platformName(),
    })
  );

  useEffect(() => {
    let cancelled = false;

    platform
      .initialize()
      .then(() => {
        if (!cancelled) {
          setError(platform.getError());
        }
      })
      .catch((bootError: unknown) => {
        if (!cancelled) {
          setError(
            bootError instanceof Error
              ? bootError.message
              : 'The plugin platform could not start.'
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [platform]);

  const value = useMemo(() => ({ platform, error }), [platform, error]);

  return (
    <PluginPlatformContext.Provider value={value}>
      {children}
    </PluginPlatformContext.Provider>
  );
}

export function usePluginPlatform(): PluginPlatformRuntime {
  const value = useContext(PluginPlatformContext);

  if (!value) {
    throw new Error('usePluginPlatform must be used inside PluginPlatformProvider.');
  }

  return value.platform;
}

export function usePluginPlatformError(): string | null {
  return useContext(PluginPlatformContext)?.error ?? null;
}

/** Snapshot of manifest contributions and plugin lifecycle state. */
export function usePluginSnapshot(): PluginPlatformSnapshot {
  const context = useContext(PluginPlatformContext);
  const platform = context?.platform ?? getPluginPlatform();

  return useSyncExternalStore(
    platform?.subscribe ?? subscribeToNothing,
    platform?.getSnapshot ?? getEmptySnapshot,
    platform?.getSnapshot ?? getEmptySnapshot
  );
}

export function usePluginSummary(pluginId: string) {
  const snapshot = usePluginSnapshot();
  return (
    snapshot.summaries.find(
      (summary) => summary.manifest.pluginId === pluginId
    ) ?? null
  );
}
