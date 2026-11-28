/**
 * Buddy reward policy.
 *
 * These numbers are identity/progression flavor only. They never affect AI
 * routing, permissions, approvals, tool grants, or Sandbox decisions.
 */

export const REWARDS = {
  taskComplete: { xp: 25, bond: 3 },
  taskCompleteHighPriority: { xp: 40, bond: 5 },
  chatMessage: { xp: 8, bond: 1 },
  dailyLogin: { xp: 15, bond: 2 },
  dailyInteraction: { xp: 6, bond: 2 },
  evolutionBonus: { xp: 50, bond: 10 },
} as const;

export type RewardReason = keyof typeof REWARDS;

/** Daily caps keep repeatable interactions from becoming unlimited XP farms. */
export const DAILY_REWARD_CAPS: Record<RewardReason, number> = {
  taskComplete: 20,
  taskCompleteHighPriority: 20,
  chatMessage: 12,
  dailyLogin: 1,
  dailyInteraction: 24,
  evolutionBonus: 4,
};

export type PriorityBucket = 'low' | 'normal' | 'high';

export function priorityBucketFromNumber(priority: number | undefined): PriorityBucket {
  if ((priority ?? 0) >= 2) return 'high';
  if ((priority ?? 0) >= 1) return 'normal';
  return 'low';
}

export function rewardAmountForTask(priority: PriorityBucket): { xp: number; bond: number } {
  return priority === 'high' ? REWARDS.taskCompleteHighPriority : REWARDS.taskComplete;
}
