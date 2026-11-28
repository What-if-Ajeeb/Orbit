import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

import { grantBuddyReward, localDay } from './reward-ledger';
import { DAILY_REWARD_CAPS, REWARDS } from './reward-policy';

type BuddyState = { level: number; xp: number; bond: number };

function makeLedgerDb(now = Date.parse('2026-11-28T10:00:00Z')) {
  const buddy: BuddyState = { level: 1, xp: 0, bond: 10 };
  const ledger = new Set<string>();
  const counters = new Map<string, number>();
  const activity: string[] = [];

  const counterKey = (userId: number, buddyId: string, day: string, action: string) =>
    `${userId}:${buddyId}:${day}:${action}`;

  const db = {
    withTransactionAsync: vi.fn(async (task: () => Promise<void>) => {
      await task();
    }),
    getFirstAsync: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM buddy_reward_ledger')) {
        return ledger.has(String(params[2])) ? { id: ledger.size } : null;
      }
      if (sql.includes('FROM buddy_daily_counters')) {
        const count = counters.get(counterKey(
          Number(params[0]),
          String(params[1]),
          String(params[2]),
          String(params[3])
        )) ?? 0;
        return count > 0 ? { count } : null;
      }
      if (sql.includes('FROM user_buddies')) return { ...buddy };
      return null;
    }),
    runAsync: vi.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('INSERT INTO buddy_reward_ledger')) {
        ledger.add(String(params[3]));
      } else if (sql.includes('INSERT INTO buddy_daily_counters')) {
        const key = counterKey(
          Number(params[0]),
          String(params[1]),
          String(params[2]),
          String(params[3])
        );
        counters.set(key, (counters.get(key) ?? 0) + 1);
      } else if (sql.includes('UPDATE user_buddies')) {
        buddy.xp = Number(params[0]);
        buddy.level = Number(params[1]);
        buddy.bond = Number(params[2]);
      } else if (sql.includes('INSERT INTO buddy_activity_log')) {
        activity.push(String(params[2]));
      }
      return { changes: 1 };
    }),
  };

  return { db: db as unknown as SQLiteDatabase, buddy, ledger, counters, activity, now };
}

describe('Buddy reward ledger', () => {
  it('uses local calendar days for daily caps', () => {
    expect(localDay(new Date(2026, 10, 28, 12, 0).getTime())).toBe('2026-11-28');
  });

  it('grants a unique reward once and records the source key', async () => {
    const state = makeLedgerDb();

    const first = await grantBuddyReward(state.db, 1, 'buddy-1', 'taskComplete', 'task-7', state.now);
    expect(first).toMatchObject({ granted: true, xpGained: REWARDS.taskComplete.xp, bondGained: REWARDS.taskComplete.bond });
    expect(state.buddy).toMatchObject({ xp: 25, bond: 13 });
    expect(state.ledger.has('taskComplete:task-7')).toBe(true);

    const replay = await grantBuddyReward(state.db, 1, 'buddy-1', 'taskComplete', 'task-7', state.now);
    expect(replay).toMatchObject({ granted: false, xpGained: 0, bondGained: 0 });
    expect(state.buddy.xp).toBe(25);
    expect(state.activity).toHaveLength(1);
  });

  it('enforces the daily cap even when source keys differ', async () => {
    const state = makeLedgerDb();

    await grantBuddyReward(state.db, 1, 'buddy-1', 'dailyLogin', 'first', state.now);
    const second = await grantBuddyReward(state.db, 1, 'buddy-1', 'dailyLogin', 'second', state.now);

    expect(second.granted).toBe(false);
    expect(DAILY_REWARD_CAPS.dailyLogin).toBe(1);
    expect(state.buddy.xp).toBe(REWARDS.dailyLogin.xp);
  });

  it('caps farming of repeatable interactions and still levels deterministically', async () => {
    const state = makeLedgerDb();
    let last = await grantBuddyReward(state.db, 1, 'buddy-1', 'chatMessage', 'm-0', state.now);

    for (let index = 1; index < DAILY_REWARD_CAPS.chatMessage; index += 1) {
      last = await grantBuddyReward(state.db, 1, 'buddy-1', 'chatMessage', `m-${index}`, state.now);
    }
    const overCap = await grantBuddyReward(state.db, 1, 'buddy-1', 'chatMessage', 'm-over', state.now);

    expect(last.granted).toBe(true);
    expect(overCap.granted).toBe(false);
    expect(state.buddy.xp).toBe(REWARDS.chatMessage.xp * DAILY_REWARD_CAPS.chatMessage);
  });

  it('levels up when enough unique rewards accumulate', async () => {
    const state = makeLedgerDb();
    let result = await grantBuddyReward(state.db, 1, 'buddy-1', 'evolutionBonus', 'form-1', state.now);

    for (let index = 2; index <= 4; index += 1) {
      result = await grantBuddyReward(state.db, 1, 'buddy-1', 'evolutionBonus', `form-${index}`, state.now);
      if (index === 2) {
        expect(result).toMatchObject({ granted: true, leveledUp: true, previousLevel: 1 });
      }
    }

    expect(result.granted).toBe(true);
    expect(state.buddy.level).toBe(2);
  });
});
