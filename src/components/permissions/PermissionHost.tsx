import { useCallback, useState, useSyncExternalStore } from 'react';

import { PermissionDialog } from '@/components/permissions/PermissionDialog';
import { useSession } from '@/context/auth';
import {
  permissionManager,
  type PermissionDecisionOption,
  type PermissionRequestRecord,
} from '@/lib/permissions';

const subscribe = (listener: () => void) => permissionManager.subscribe(listener);
const getSnapshot = () => permissionManager.getState();
const getServerSnapshot = () => permissionManager.getState();

/**
 * Global approval surface. Every protected tool call blocks inside the
 * Permission Manager until this host resolves the request. It is mounted once
 * in the authenticated app layout so chat, harness, and subagent tool calls all
 * share the same up-to-date consent queue.
 */
export function PermissionHost() {
  const { user } = useSession();
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const request: PermissionRequestRecord | undefined = user
    ? state.queue.find((entry) => entry.userId === user.id)
    : undefined;

  if (!request) {
    return null;
  }

  const queued = user
    ? state.queue.filter((entry) => entry.userId === user.id).length
    : 1;

  return <PermissionPrompt key={request.id} request={request} queued={queued} />;
}

function PermissionPrompt({
  request,
  queued,
}: {
  request: PermissionRequestRecord;
  queued: number;
}) {
  const [busy, setBusy] = useState<PermissionDecisionOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolve = useCallback(
    async (option: PermissionDecisionOption) => {
      if (busy) {
        return;
      }

      setBusy(option);
      setError(null);

      try {
        const result = await permissionManager.resolveRequest(request.id, option, request.userId);

        if (!result.ok) {
          setError(result.message ?? 'The permission request could not be resolved.');
          setBusy(null);
        }
      } catch (resolveError) {
        setError(
          resolveError instanceof Error
            ? resolveError.message
            : 'The permission request could not be resolved.'
        );
        setBusy(null);
      }
    },
    [busy, request]
  );

  const cancel = useCallback(() => {
    if (busy) {
      return;
    }

    void (async () => {
      try {
        const result = await permissionManager.cancelRequest(request.id, request.userId);

        if (!result.ok) {
          setError(result.message ?? 'The permission request could not be cancelled.');
        }
      } catch (cancelError) {
        setError(
          cancelError instanceof Error
            ? cancelError.message
            : 'The permission request could not be cancelled.'
        );
      }
    })();
  }, [busy, request]);

  return (
    <PermissionDialog
      request={request}
      queued={queued}
      busy={busy}
      error={error}
      onResolve={(option) => {
        void resolve(option);
      }}
      onCancel={cancel}
    />
  );
}
