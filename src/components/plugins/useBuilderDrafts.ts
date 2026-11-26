import { useCallback, useEffect, useRef, useState } from 'react';

import { usePluginPlatform } from '@/context/plugins';
import {
  deleteBuilderDraft,
  duplicateBuilderDraft,
  getBuilderDraft,
  loadBuilderDrafts,
  saveBuilderDraft,
} from '@/lib/plugins/builder-store';
import type { BuilderDraft } from '@/lib/plugins/builder';

export type BuilderDraftsState = {
  drafts: BuilderDraft[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
  save: (draft: BuilderDraft) => Promise<BuilderDraft>;
  remove: (pluginId: string) => Promise<void>;
  duplicate: (
    pluginId: string,
    newPluginId: string,
    newName: string
  ) => Promise<BuilderDraft>;
  find: (pluginId: string) => Promise<BuilderDraft | null>;
};

/** Loads and mutates builder drafts through the canonical persistence seam. */
export function useBuilderDrafts(): BuilderDraftsState {
  const platform = usePluginPlatform();
  const [drafts, setDrafts] = useState<BuilderDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let active = true;

    void (async () => {
      try {
        const next = await loadBuilderDrafts(platform.persistence);
        if (active) {
          setDrafts(next);
          setError(null);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load builder drafts.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
      mounted.current = false;
    };
  }, [platform.persistence]);

  const reload = useCallback(async () => {
    try {
      const next = await loadBuilderDrafts(platform.persistence);
      if (mounted.current) {
        setDrafts(next);
        setError(null);
      }
    } catch (loadError) {
      if (mounted.current) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Could not load builder drafts.'
        );
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [platform.persistence]);

  const save = useCallback(
    async (draft: BuilderDraft) => {
      const next = await saveBuilderDraft(platform.persistence, draft);
      if (mounted.current) {
        setDrafts((current) => [
          next,
          ...current.filter((entry) => entry.pluginId !== next.pluginId),
        ]);
      }
      return next;
    },
    [platform.persistence]
  );

  const remove = useCallback(
    async (pluginId: string) => {
      await deleteBuilderDraft(platform.persistence, pluginId);
      if (mounted.current) {
        setDrafts((current) => current.filter((entry) => entry.pluginId !== pluginId));
      }
    },
    [platform.persistence]
  );

  const duplicate = useCallback(
    async (pluginId: string, newPluginId: string, newName: string) => {
      const next = await duplicateBuilderDraft(
        platform.persistence,
        pluginId,
        newPluginId,
        newName
      );
      if (mounted.current) {
        setDrafts((current) => [next, ...current]);
      }
      return next;
    },
    [platform.persistence]
  );

  const find = useCallback(
    async (pluginId: string) => getBuilderDraft(platform.persistence, pluginId),
    [platform.persistence]
  );

  return { drafts, loading, error, reload, save, remove, duplicate, find };
}
