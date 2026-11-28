/**
 * Idempotent Buddy reward ledger.
 *
 * Rewards are progression-only. A unique ledger key and daily counters prevent
 * duplicate XP/bond and repeatable farming. This module intentionally does not
 * import the Buddy store, so lifecycle code can use it without cycles.
 */

import type { SQLiteDatabase } from 'expo-sqlite';

import { DAILY_REWARD_CAPS, REWARDS, type RewardReason } from './reward-policy';
import { xpForLevel } from './types';

export interface BuddyRewardGrant {
  granted: boolean;
  xpGained: number;
  bondGained: number;
  leveledUp: boolean;
  previousLevel: number;
}

export function localDay(timestamp = Date.now()): string {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function sourceKeyFor(reason: RewardReason, sourceKey: string): string {
  return `${reason}:${sourceKey}`.slice(0, 240);
}

export async function grantBuddyReward(
  db: SQLiteDatabase,
  userId: number,
  buddyId: string,
  reason: RewardReason,
  sourceKey: string,
  now = Date.now()
): Promise<BuddyRewardGrant> {
  const amount = REWARDS[reason];
  const key = sourceKeyFor(reason, sourceKey);
  let result: BuddyRewardGrant = {
    granted: false,
    xpGained: 0,
    bondGained: 0,
    leveledUp: false,
    previousLevel: 0,
  };

  await db.withTransactionAsync(async () => {
    const already = await db.getFirstAsync<{ id: number }>(
      `SELECT id FROM buddy_reward_ledger
       WHERE user_id = ? AND user_buddy_id = ? AND source_key = ? LIMIT 1`,
      [userId, buddyId, key]
    );
    if (already) return;

    const day = localDay(now);
    const counter = await db.getFirstAsync<{ count: number }>(
      `SELECT count FROM buddy_daily_counters
       WHERE user_id = ? AND user_buddy_id = ? AND day = ? AND action = ?`,
      [userId, buddyId, day, reason]
    );
    if ((counter?.count ?? 0) >= DAILY_REWARD_CAPS[reason]) return;

    const buddy = await db.getFirstAsync<{
      level: number;
      xp: number;
      bond: number;
    }>('SELECT level, xp, bond FROM user_buddies WHERE id = ? AND user_id = ?', [buddyId, userId]);
    if (!buddy) return;

    await db.runAsync(
      `INSERT INTO buddy_reward_ledger
        (user_id, user_buddy_id, reason, source_key, xp, bond, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, buddyId, reason, key, amount.xp, amount.bond, now]
    );
    await db.runAsync(
      `INSERT INTO buddy_daily_counters (user_id, user_buddy_id, day, action, count)
       VALUES (?, ?, ?, ?, 1)
       ON CONFLICT(user_id, user_buddy_id, day, action) DO UPDATE SET count = count + 1`,
      [userId, buddyId, day, reason]
    );

    let level = buddy.level;
    let xp = buddy.xp + amount.xp;
    while (xp >= xpForLevel(level) && level < 99) level += 1;
    const bond = Math.min(100, Math.max(0, buddy.bond + amount.bond));

    await db.runAsync(
      `UPDATE user_buddies
       SET xp = ?, level = ?, bond = ?, updated_at = ?, last_interacted_at = ?
       WHERE id = ? AND user_id = ?`,
      [xp, level, bond, now, now, buddyId, userId]
    );
    await db.runAsync(
      `INSERT INTO buddy_activity_log
        (user_id, user_buddy_id, activity, xp_gained, bond_gained, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, buddyId, `Reward: ${reason}`, amount.xp, amount.bond, now]
    );

    result = {
      granted: true,
      xpGained: amount.xp,
      bondGained: amount.bond,
      leveledUp: level > buddy.level,
      previousLevel: buddy.level,
    };
  });

  return result;
}
