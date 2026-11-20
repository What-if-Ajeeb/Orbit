import { useEffect, type PropsWithChildren } from 'react';

import { getAppContext, mountOrbitSpine, type AppContextResult } from './context';

export type { AppContextResult };

let promise: Promise<AppContextResult> | null = null;

function ensureOrbitSpine(): Promise<AppContextResult> {
  promise ??= mountOrbitSpine();
  return promise;
}

export function useAppContext(): AppContextResult | null {
  return getAppContext();
}

/**
 * Mounts the Orbit plugin spine once for the app lifetime. Mount this inside
 * the root layout; services are disposable via their fibers for tests.
 */
export function HarnessProvider({ children }: PropsWithChildren) {
  useEffect(() => {
    void ensureOrbitSpine().catch((error) => {
      console.warn('Failed to mount the Orbit harness spine.', error);
    });
  }, []);

  return children;
}
