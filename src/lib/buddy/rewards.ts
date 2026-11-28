import type { SQLiteDatabase } from 'expo-sqlite';

import { grantBuddyReward, localDay } from './reward-ledger';
import type { PriorityBucket, RewardReason } from './reward-policy';
import { addBond, addXp, getActiveBuddy, getUserBuddy } from './store';
import type { UserBuddy } from './types';

export { REWARDS } from './reward-policy';

export type RewardResult = {
  buddy: UserBuddy | null;
  xpGained: number;
  bondGained: number;
  leveledUp: boolean;
  previousLevel: number;
};

const EMPTY_RESULT: RewardResult = {
  buddy: null,
  xpGained: 0,
  bondGained: 0,
  leveledUp: false,
  previousLevel: 0,
};

async function grantCanonicalReward(
  db: SQLiteDatabase,
  userId: number,
  reason: RewardReason,
  sourceKey: string,
  now = Date.now()
): Promise<RewardResult> {
  const active = await getActiveBuddy(db, userId);
  if (!active) return EMPTY_RESULT;

  const ledger = await grantBuddyReward(db, userId, active.id, reason, sourceKey, now);
  const buddy = await getUserBuddy(db, userId, active.id);
  return {
    buddy,
    xpGained: ledger.xpGained,
    bondGained: ledger.bondGained,
    leveledUp: ledger.leveledUp,
    previousLevel: ledger.previousLevel,
  };
}

/**
 * Legacy arbitrary-reward helper retained for callers that need a one-off
 * amount. Canonical lifecycle rewards must use the ledger-backed helpers below
 * so source keys cannot be replayed for unlimited XP.
 */
export async function rewardActiveBuddy(
  db: SQLiteDatabase,
  userId: number,
  xp: number,
  bond: number
): Promise<RewardResult> {
  const active = await getActiveBuddy(db, userId);
  if (!active) return EMPTY_RESULT;

  const previousLevel = active.level;
  let buddy = active;
  let leveledUp = false;
  if (xp > 0) {
    const xpResult = await addXp(db, userId, active.id, xp);
    buddy = xpResult.buddy;
    leveledUp = xpResult.leveledUp;
  }
  if (bond > 0) buddy = await addBond(db, userId, active.id, bond);

  return { buddy, xpGained: xp, bondGained: bond, leveledUp, previousLevel };
}

export async function rewardTaskComplete(
  db: SQLiteDatabase,
  userId: number,
  priority: PriorityBucket = 'normal',
  taskId: string,
  now = Date.now()
): Promise<RewardResult> {
  const reason: RewardReason =
    priority === 'high' ? 'taskCompleteHighPriority' : 'taskComplete';
  return grantCanonicalReward(db, userId, reason, taskId, now);
}

export async function rewardChatMessage(
  db: SQLiteDatabase,
  userId: number,
  messageId: string,
  now = Date.now()
): Promise<RewardResult> {
  return grantCanonicalReward(db, userId, 'chatMessage', messageId, now);
}

export async function rewardDailyLogin(
  db: SQLiteDatabase,
  userId: number,
  now = Date.now()
): Promise<RewardResult> {
  return grantCanonicalReward(db, userId, 'dailyLogin', localDay(now), now);
}

export async function rewardDailyInteraction(
  db: SQLiteDatabase,
  userId: number,
  occurrenceId: string,
  now = Date.now()
): Promise<RewardResult> {
  return grantCanonicalReward(db, userId, 'dailyInteraction', occurrenceId, now);
}
