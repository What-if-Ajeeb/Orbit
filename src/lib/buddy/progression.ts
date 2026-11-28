/**
 * Buddy progression storage: reaction history, achievements, character unlocks
 * and cosmetic choices. All values are local identity/progression flavor; none
 * of them grants capabilities or changes Agent behavior.
 */

import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';

import type { ReactionDecision } from './engine/reactionEngine';
import { getDefaultForm, SPECIES } from './species';
import type { BuddyAccessory, BuddyMood, UserBuddy } from './types';
import { localDay } from './reward-ledger';

export type BuddyAchievementRecord = {
  id: string;
  title: string;
  description: string;
  unlockedAt: number | null;
};

export type BuddyReactionRecord = {
  id: number;
  eventKey: string;
  eventType: string;
  templateId: string;
  message: string;
  animation: string;
  mood: string;
  presentation: string;
  createdAt: number;
};

export type BuddyCharacterUnlockRecord = {
  speciesId: string;
  unlockedAt: number | null;
  reason: string | null;
};

export const BUDDY_ACCESSORIES: { id: BuddyAccessory; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'bow', label: 'Bow' },
  { id: 'scarf', label: 'Scarf' },
  { id: 'crown', label: 'Crown' },
  { id: 'star', label: 'Star' },
];

export const BUDDY_ACHIEVEMENTS = [
  { id: 'first_reward', title: 'First Step', description: 'Earn your first Buddy reward.' },
  { id: 'task_helper', title: 'Task Helper', description: 'Complete a task with your Buddy.' },
  { id: 'bonded', title: 'Trusted Friend', description: 'Reach 50% bond with your Buddy.' },
  { id: 'level_five', title: 'Growing Together', description: 'Reach Buddy level 5.' },
  { id: 'collector', title: 'Buddy Collector', description: 'Unlock a second character.' },
] as const;

type UnlockRule = {
  speciesId: string;
  level?: number;
  bond?: number;
  taskRewards?: number;
  interactions?: number;
  achievement?: string;
  reason: string;
};

/**
 * Every canonical character has a deterministic unlock path. These thresholds
 * are flavor only and are independent of permissions, tools and AI routing.
 */
export const CHARACTER_UNLOCK_RULES: UnlockRule[] = [
  { speciesId: 'fox', reason: 'Starter companion' },
  { speciesId: 'raven', level: 2, reason: 'Reach level 2' },
  { speciesId: 'owl', bond: 30, reason: 'Reach 30% bond' },
  { speciesId: 'bear', level: 4, reason: 'Reach level 4' },
  { speciesId: 'wolf', bond: 50, reason: 'Reach 50% bond' },
  { speciesId: 'deer', level: 6, reason: 'Reach level 6' },
  { speciesId: 'labrador', interactions: 8, reason: 'Share 8 interactions' },
  { speciesId: 'dolphin', level: 8, reason: 'Reach level 8' },
  { speciesId: 'beaver', taskRewards: 5, reason: 'Complete 5 rewarded tasks' },
  { speciesId: 'elephant', bond: 70, reason: 'Reach 70% bond' },
  { speciesId: 'lion', level: 10, reason: 'Reach level 10' },
  { speciesId: 'golden-retriever', taskRewards: 10, reason: 'Complete 10 rewarded tasks' },
  { speciesId: 'cat', level: 12, reason: 'Reach level 12' },
  { speciesId: 'panda', bond: 90, reason: 'Reach 90% bond' },
  { speciesId: 'cheetah', level: 15, reason: 'Reach level 15' },
  { speciesId: 'parrot', achievement: 'collector', reason: 'Unlock a second character' },
];

export async function recordBuddyReaction(
  db: SQLiteDatabase,
  userId: number,
  buddyId: string,
  decision: ReactionDecision,
  now = Date.now()
): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO buddy_reactions
      (user_id, user_buddy_id, event_key, event_type, template_id, message,
       animation, mood, presentation, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      buddyId,
      decision.eventKey,
      decision.eventType,
      decision.templateId,
      decision.message,
      decision.animation,
      decision.mood,
      decision.presentation,
      now,
    ]
  );
  return result.changes > 0;
}

export async function listBuddyReactions(
  db: SQLiteDatabase,
  userId: number,
  limit = 50
): Promise<BuddyReactionRecord[]> {
  const rows = await db.getAllAsync<any>(
    `SELECT event_key, event_type, template_id, message, animation, mood,
            presentation, created_at
     FROM buddy_reactions
     WHERE user_id = ?
     ORDER BY created_at DESC, id DESC
     LIMIT ?`,
    [userId, Math.max(1, Math.min(200, limit))]
  );
  return rows.map((row) => ({
    id: row.created_at,
    eventKey: row.event_key,
    eventType: row.event_type,
    templateId: row.template_id,
    message: row.message,
    animation: row.animation,
    mood: row.mood,
    presentation: row.presentation,
    createdAt: row.created_at,
  }));
}

async function countRewards(
  db: SQLiteDatabase,
  userId: number,
  reasons: string[]
): Promise<number> {
  if (reasons.length === 0) return 0;
  const placeholders = reasons.map(() => '?').join(', ');
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) AS count FROM buddy_reward_ledger
     WHERE user_id = ? AND reason IN (${placeholders})`,
    [userId, ...reasons]
  );
  return row?.count ?? 0;
}

export async function listDailyCounters(
  db: SQLiteDatabase,
  userId: number,
  buddyId: string,
  now = Date.now()
) {
  return db.getAllAsync<{ action: string; count: number }>(
    `SELECT action, count FROM buddy_daily_counters
     WHERE user_id = ? AND user_buddy_id = ? AND day = ?`,
    [userId, buddyId, localDay(now)]
  );
}

export async function listBuddyAchievements(
  db: SQLiteDatabase,
  userId: number,
  buddyId: string
): Promise<BuddyAchievementRecord[]> {
  const rows = await db.getAllAsync<{ achievement_id: string; unlocked_at: number }>(
    `SELECT achievement_id, unlocked_at FROM buddy_achievements
     WHERE user_id = ? AND user_buddy_id = ?`,
    [userId, buddyId]
  );
  const byId = new Map(rows.map((row) => [row.achievement_id, row.unlocked_at]));
  return BUDDY_ACHIEVEMENTS.map((achievement) => ({
    ...achievement,
    unlockedAt: byId.get(achievement.id) ?? null,
  }));
}

export async function listCharacterUnlocks(
  db: SQLiteDatabase,
  userId: number
): Promise<BuddyCharacterUnlockRecord[]> {
  const rows = await db.getAllAsync<{
    species_id: string;
    unlocked_at: number;
    reason: string;
  }>(
    `SELECT species_id, unlocked_at, reason FROM buddy_character_unlocks
     WHERE user_id = ?`,
    [userId]
  );
  const byId = new Map(rows.map((row) => [row.species_id, row]));
  return CHARACTER_UNLOCK_RULES.map((rule) => ({
    speciesId: rule.speciesId,
    unlockedAt: byId.get(rule.speciesId)?.unlocked_at ?? null,
    reason: byId.get(rule.speciesId)?.reason ?? rule.reason,
  }));
}

/**
 * Re-evaluate deterministic achievements and character unlocks after a reward.
 * Returns only the newly granted ids so callers can surface them once.
 */
export async function evaluateBuddyProgress(
  db: SQLiteDatabase,
  userId: number,
  buddy: UserBuddy,
  now = Date.now()
): Promise<{ achievements: string[]; characters: string[] }> {
  const [taskRewards, interactions, ownedCount, achievementRows, unlockRows] = await Promise.all([
    countRewards(db, userId, ['taskComplete', 'taskCompleteHighPriority']),
    countRewards(db, userId, ['dailyInteraction']),
    db.getFirstAsync<{ count: number }>(
      'SELECT COUNT(*) AS count FROM user_buddies WHERE user_id = ?',
      [userId]
    ),
    db.getAllAsync<{ achievement_id: string }>(
      'SELECT achievement_id FROM buddy_achievements WHERE user_id = ? AND user_buddy_id = ?',
      [userId, buddy.id]
    ),
    db.getAllAsync<{ species_id: string }>(
      'SELECT species_id FROM buddy_character_unlocks WHERE user_id = ?',
      [userId]
    ),
  ]);

  const unlockedAchievements = new Set(achievementRows.map((row) => row.achievement_id));
  const unlockedCharacters = new Set(unlockRows.map((row) => row.species_id));
  const newAchievements: string[] = [];
  const newCharacters: string[] = [];

  const earn = async (id: string) => {
    if (unlockedAchievements.has(id)) return;
    const result = await db.runAsync(
      `INSERT OR IGNORE INTO buddy_achievements
        (user_id, user_buddy_id, achievement_id, unlocked_at)
       VALUES (?, ?, ?, ?)`,
      [userId, buddy.id, id, now]
    );
    if (result.changes > 0) {
      unlockedAchievements.add(id);
      newAchievements.push(id);
    }
  };

  if (taskRewards + interactions > 0) await earn('first_reward');
  if (taskRewards > 0) await earn('task_helper');
  if (buddy.bond >= 50) await earn('bonded');
  if (buddy.level >= 5) await earn('level_five');
  if ((ownedCount?.count ?? 0) >= 2) await earn('collector');

  for (const rule of CHARACTER_UNLOCK_RULES) {
    if (unlockedCharacters.has(rule.speciesId)) continue;
    const meetsLevel = !rule.level || buddy.level >= rule.level;
    const meetsBond = !rule.bond || buddy.bond >= rule.bond;
    const meetsTasks = !rule.taskRewards || taskRewards >= rule.taskRewards;
    const meetsInteractions = !rule.interactions || interactions >= rule.interactions;
    const meetsAchievement = !rule.achievement || unlockedAchievements.has(rule.achievement);
    if (!meetsLevel || !meetsBond || !meetsTasks || !meetsInteractions || !meetsAchievement) continue;

    const result = await db.runAsync(
      `INSERT OR IGNORE INTO buddy_character_unlocks
        (user_id, species_id, unlocked_at, reason)
       VALUES (?, ?, ?, ?)`,
      [userId, rule.speciesId, now, rule.reason]
    );
    if (result.changes > 0) newCharacters.push(rule.speciesId);
  }

  return { achievements: newAchievements, characters: newCharacters };
}

/** Claim an unlocked species as a new, inactive buddy. */
export async function claimUnlockedCharacter(
  db: SQLiteDatabase,
  userId: number,
  speciesId: string
): Promise<UserBuddy | null> {
  const unlock = await db.getFirstAsync<{ species_id: string }>(
    'SELECT species_id FROM buddy_character_unlocks WHERE user_id = ? AND species_id = ?',
    [userId, speciesId]
  );
  if (!unlock) return null;

  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM user_buddies WHERE user_id = ? AND species_id = ? LIMIT 1',
    [userId, speciesId]
  );
  if (existing) return null;

  const form = getDefaultForm(speciesId);
  if (!form) return null;

  const id = randomUUID();
  const ts = Date.now();
  await db.runAsync(
    `INSERT INTO user_buddies
      (id, user_id, species_id, nickname, current_form_id, level, xp, bond,
       is_active, mood, unlocked_forms, created_at, updated_at, last_interacted_at)
     VALUES (?, ?, ?, NULL, ?, 1, 0, 0, 0, 'calm', ?, ?, ?, NULL)`,
    [id, userId, speciesId, form.id, JSON.stringify([form.id]), ts, ts]
  );
  const row = await db.getFirstAsync<any>('SELECT * FROM user_buddies WHERE id = ?', [id]);
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    speciesId: row.species_id,
    nickname: row.nickname,
    currentFormId: row.current_form_id,
    level: row.level,
    xp: row.xp,
    bond: row.bond,
    isActive: !!row.is_active,
    mood: (row.mood as BuddyMood) ?? 'calm',
    unlockedForms: JSON.parse(row.unlocked_forms || '[]'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastInteractedAt: row.last_interacted_at,
  };
}

export async function setBuddyNickname(
  db: SQLiteDatabase,
  userId: number,
  buddyId: string,
  nickname: string
): Promise<void> {
  const clean = nickname.trim().slice(0, 40);
  await db.runAsync(
    'UPDATE user_buddies SET nickname = ?, updated_at = ? WHERE id = ? AND user_id = ?',
    [clean || null, Date.now(), buddyId, userId]
  );
}

export async function getBuddyCustomization(
  db: SQLiteDatabase,
  userId: number,
  buddyId: string
): Promise<Record<string, string>> {
  const rows = await db.getAllAsync<{ key: string; value: string }>(
    'SELECT key, value FROM buddy_customization WHERE user_id = ? AND user_buddy_id = ?',
    [userId, buddyId]
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function setBuddyCustomization(
  db: SQLiteDatabase,
  userId: number,
  buddyId: string,
  key: string,
  value: string
): Promise<void> {
  const safeKey = key.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 40);
  const safeValue = value.slice(0, 120);
  if (!safeKey) return;
  await db.runAsync(
    `INSERT INTO buddy_customization (user_id, user_buddy_id, key, value, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, user_buddy_id, key)
     DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [userId, buddyId, safeKey, safeValue, Date.now()]
  );
}

export function isKnownCharacter(speciesId: string): boolean {
  return SPECIES.some((species) => species.id === speciesId);
}
