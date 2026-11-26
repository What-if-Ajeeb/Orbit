import { useCallback, useEffect, useRef, useState } from 'react';

import { usePluginPlatform } from '@/context/plugins';
import type { BuilderLog } from '@/lib/plugins/builder';
import { clearBuilderLogs, loadBuilderLogs } from '@/lib/plugins/builder-store';

export type BuilderLogsState = {
  logs: BuilderLog[];
  loading: boolean;
  reload: () => Promise<void>;
  clear: () => Promise<void>;
};

export function useBuilderLogs(pluginId: string): BuilderLogsState {
  const platform = usePluginPlatform();
  const [logs, setLogs] = useState<BuilderLog[]>([]);
  const [loading, setLoading] = useState(true);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const next = await loadBuilderLogs(
        platform.persistence,
        pluginId || undefined
      );
      if (mounted.current) setLogs(next);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [platform.persistence, pluginId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const clear = useCallback(async () => {
    await clearBuilderLogs(platform.persistence, pluginId || undefined);
    if (mounted.current) setLogs([]);
  }, [platform.persistence, pluginId]);

  return { logs, loading, reload, clear };
}
