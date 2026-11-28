import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { rewardChatMessage, rewardDailyLogin, rewardDailyInteraction, rewardTaskComplete } from './rewards';

const mocks = vi.hoisted(() => ({
  grantBuddyReward: vi.fn(async () => ({
    granted: true,
    xpGained: 1,
    bondGained: 1,
    leveledUp: false,
    previousLevel: 1,
  })),
  localDay: vi.fn(() => '2026-11-28'),
  getActiveBuddy: vi.fn(async () => ({ id: 'buddy-1' })),
  getUserBuddy: vi.fn(async () => ({ id: 'buddy-1', level: 1 })),
  addXp: vi.fn(),
  addBond: vi.fn(),
}));

vi.mock('./reward-ledger', () => ({
  grantBuddyReward: mocks.grantBuddyReward,
  localDay: mocks.localDay,
}));

vi.mock('./store', () => ({
  getActiveBuddy: mocks.getActiveBuddy,
  getUserBuddy: mocks.getUserBuddy,
  addXp: mocks.addXp,
  addBond: mocks.addBond,
}));

const db = {} as SQLiteDatabase;

describe('canonical Buddy reward helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the task id as the dedupe key and maps priority to a reason', async () => {
    await rewardTaskComplete(db, 7, 'high', 'task-9', 100);
    expect(mocks.grantBuddyReward).toHaveBeenCalledWith(
      db,
      7,
      'buddy-1',
      'taskCompleteHighPriority',
      'task-9',
      100
    );
  });

  it('uses message and interaction ids so repeated user events cannot replay rewards', async () => {
    await rewardChatMessage(db, 7, 'message-3', 100);
    await rewardDailyInteraction(db, 7, 'interaction-4', 100);
    expect(mocks.grantBuddyReward).toHaveBeenNthCalledWith(1, db, 7, 'buddy-1', 'chatMessage', 'message-3', 100);
    expect(mocks.grantBuddyReward).toHaveBeenNthCalledWith(2, db, 7, 'buddy-1', 'dailyInteraction', 'interaction-4', 100);
  });

  it('keys the daily login reward by local day', async () => {
    await rewardDailyLogin(db, 7, 100);
    expect(mocks.localDay).toHaveBeenCalledWith(100);
    expect(mocks.grantBuddyReward).toHaveBeenCalledWith(
      db,
      7,
      'buddy-1',
      'dailyLogin',
      '2026-11-28',
      100
    );
  });
});
