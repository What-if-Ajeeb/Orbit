import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AccessibilityInfo } from 'react-native';

import { useSession } from '@/context/auth';
import { getBuddyCharacterProfile } from '@/lib/buddy/characters/profiles';
import { BuddyCooldowns } from '@/lib/buddy/engine/cooldowns';
import { resolveReaction, type ReactionDecision } from '@/lib/buddy/engine/reactionEngine';
import { subscribeBuddyEvents } from '@/lib/buddy/events';
import {
  evaluateBuddyProgress,
  listBuddyReactions,
  recordBuddyReaction,
  type BuddyReactionRecord,
} from '@/lib/buddy/progression';
import { grantBuddyReward } from '@/lib/buddy/reward-ledger';
import { getActiveBuddy, getUserBuddy } from '@/lib/buddy/store';
import type { UserBuddy } from '@/lib/buddy/types';

export type BuddyReactionsSnapshot = {
  reaction: ReactionDecision | null;
  recent: BuddyReactionRecord[];
  dismiss: () => void;
};

const BuddyReactionsContext = createContext<BuddyReactionsSnapshot | null>(null);

export function BuddyReactionProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { user } = useSession();
  const userId = user?.id ?? null;

  const [reaction, setReaction] = useState<ReactionDecision | null>(null);
  const [recent, setRecent] = useState<BuddyReactionRecord[]>([]);

  const buddyRef = useRef<UserBuddy | null>(null);
  const cooldownRef = useRef(new BuddyCooldowns());
  const reducedMotionRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let subscription: { remove: () => void } | null = null;

    void AccessibilityInfo.isReduceMotionEnabled()
      .then((enabled) => {
        reducedMotionRef.current = enabled;
      })
      .catch(() => {
        reducedMotionRef.current = false;
      });

    try {
      subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', (enabled) => {
        reducedMotionRef.current = enabled;
      });
    } catch {
      subscription = null;
    }

    return () => {
      mountedRef.current = false;
      subscription?.remove();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      await Promise.resolve();
      if (cancelled) return;

      if (userId === null) {
        buddyRef.current = null;
        setRecent([]);
        setReaction(null);
        return;
      }

      cooldownRef.current.reset();
      setReaction(null);

      try {
        const [buddy, history] = await Promise.all([
          getActiveBuddy(db, userId),
          listBuddyReactions(db, userId, 30),
        ]);
        if (cancelled) return;
        buddyRef.current = buddy;
        setRecent(history);
      } catch (error) {
        console.warn('Buddy reaction history could not load.', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, userId]);

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setReaction(null);
  }, []);

  useEffect(() => {
    if (userId === null) return;

    return subscribeBuddyEvents((event) => {
      if (event.userId !== userId) return;
      const buddy = buddyRef.current;
      if (!buddy) return;

      try {
        if (!cooldownRef.current.shouldPresent(event)) return;

        const decision = resolveReaction(
          event,
          getBuddyCharacterProfile(buddy.speciesId),
          buddy,
          { reducedMotion: reducedMotionRef.current, appActive: true }
        );
        if (decision.presentation === 'suppressed') return;

        const createdAt = event.occurredAt || Date.now();
        const record: BuddyReactionRecord = {
          id: createdAt,
          eventKey: decision.eventKey,
          eventType: decision.eventType,
          templateId: decision.templateId,
          message: decision.message,
          animation: decision.animation,
          mood: decision.mood,
          presentation: decision.presentation,
          createdAt,
        };

        if (mountedRef.current) {
          setReaction(decision);
          setRecent((current) => [record, ...current.filter((item) => item.eventKey !== record.eventKey)].slice(0, 30));
        }

        void recordBuddyReaction(db, userId, buddy.id, decision, createdAt).catch((error) => {
          console.warn('Buddy reaction could not be stored.', error);
        });

        if (decision.reward) {
          void (async () => {
            try {
              const grant = await grantBuddyReward(
                db,
                userId,
                buddy.id,
                decision.reward!.reason,
                decision.reward!.sourceKey,
                createdAt
              );
              if (!grant.granted) return;
              const updated = await getUserBuddy(db, userId, buddy.id);
              if (updated) buddyRef.current = updated;
              await evaluateBuddyProgress(db, userId, updated ?? buddy, createdAt);
            } catch (error) {
              console.warn('Buddy progression could not be updated.', error);
            }
          })();
        }

        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        if (decision.durationMs > 0) {
          timerRef.current = setTimeout(() => {
            timerRef.current = null;
            if (mountedRef.current) setReaction((current) =>
              current?.eventKey === decision.eventKey ? null : current
            );
          }, decision.durationMs);
        }
      } catch (error) {
        console.warn('Buddy reaction could not be resolved.', error);
      }
    });
  }, [db, userId]);

  const value = useMemo<BuddyReactionsSnapshot>(
    () => ({ reaction, recent, dismiss }),
    [dismiss, reaction, recent]
  );

  return <BuddyReactionsContext.Provider value={value}>{children}</BuddyReactionsContext.Provider>;
}

export function useBuddyReactions(): BuddyReactionsSnapshot {
  const value = useContext(BuddyReactionsContext);
  if (!value) {
    return { reaction: null, recent: [], dismiss: () => undefined };
  }
  return value;
}
