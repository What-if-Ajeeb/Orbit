import type { SQLiteDatabase } from 'expo-sqlite';

import { addBond, addXp, getActiveBuddy } from './store';
import type { UserBuddy } from './types';

/** Reward amounts (tunable) */
export const REWARDS = {
  taskComplete: { xp: 25, bond: 3 },
  taskCompleteHighPriority: { xp: 40, bond: 5 },
  chatMessage: { xp: 8, bond: 1 },
  dailyLogin: { xp: 15, bond: 2 },
  evolutionBonus: { xp: 50, bond: 10 },
} as const;

export type RewardResult = {
  buddy: UserBuddy | null;
  xpGained: number;
  bondGained: number;
  leveledUp: boolean;
  previousLevel: number;
};

/**
 * Give XP + bond to the user's active buddy.
 * Safe to call even if no buddy exists (returns null).
 */
export async function rewardActiveBuddy(
  db: SQLiteDatabase,
  userId: number,
  xp: number,
  bond: number
): Promise<RewardResult> {
  const active = await getActiveBuddy(db, userId);

  if (!active) {
    return {
      buddy: null,
      xpGained: 0,
      bondGained: 0,
      leveledUp: false,
      previousLevel: 0,
    };
  }

  const previousLevel = active.level;
  let buddy = active;

  if (xp > 0) {
    buddy = await addXp(db, active.id, xp);
  }
  if (bond > 0) {
    buddy = await addBond(db, active.id, bond);
  }

  return {
    buddy,
    xpGained: xp,
    bondGained: bond,
    leveledUp: buddy.level > previousLevel,
    previousLevel,
  };
}

export async function rewardTaskComplete(
  db: SQLiteDatabase,
  userId: number,
  priority: 'low' | 'normal' | 'high' = 'normal'
): Promise<RewardResult> {
  const amount =
    priority === 'high' ? REWARDS.taskCompleteHighPriority : REWARDS.taskComplete;
  return rewardActiveBuddy(db, userId, amount.xp, amount.bond);
}

export async function rewardChatMessage(
  db: SQLiteDatabase,
  userId: number
): Promise<RewardResult> {
  return rewardActiveBuddy(
    db,
    userId,
    REWARDS.chatMessage.xp,
    REWARDS.chatMessage.bond
  );
}
