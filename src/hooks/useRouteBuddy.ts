import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';

import { useSession } from '@/context/auth';
import { ensureStarterBuddy, getUserBuddy, type UserBuddy } from '@/lib/buddy';

/** Loads the buddy referenced by `?id=`, falling back to the active buddy. */
export function useRouteBuddy() {
  const db = useSQLiteContext();
  const { user } = useSession();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [buddy, setBuddy] = useState<UserBuddy | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    if (!user) return;

    void (async () => {
      setLoading(true);
      try {
        const found = id ? await getUserBuddy(db, user.id, id) : null;
        const active = found ?? (await ensureStarterBuddy(db, user.id));
        if (!cancelled) setBuddy(active);
      } catch (error) {
        console.warn('Could not load buddy details.', error);
        if (!cancelled) setBuddy(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, id, user]);

  return { buddy, loading };
}
