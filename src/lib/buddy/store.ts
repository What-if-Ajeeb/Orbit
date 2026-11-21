import type { SQLiteDatabase } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';

import type { UserBuddy, BuddyInventoryItem, EvolutionResult } from './types';
import { getSpecies, getForm, getDefaultActiveSpecies } from './species';
import { xpForLevel } from './types';

function now() {
  return Date.now();
}

function parseUnlockedForms(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function rowToUserBuddy(row: any): UserBuddy {
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
    unlockedForms: parseUnlockedForms(row.unlocked_forms),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastInteractedAt: row.last_interacted_at,
  };
}

/** Ensure the user has at least the starter buddy (Kiko). */
export async function ensureStarterBuddy(
  db: SQLiteDatabase,
  userId: number
): Promise<UserBuddy> {
  const existing = await db.getFirstAsync<any>(
    `SELECT * FROM user_buddies WHERE user_id = ? AND is_active = 1 LIMIT 1`,
    [userId]
  );

  if (existing) {
    return rowToUserBuddy(existing);
  }

  // Check if user already has any buddy
  const any = await db.getFirstAsync<any>(
    `SELECT * FROM user_buddies WHERE user_id = ? LIMIT 1`,
    [userId]
  );

  if (any) {
    // Activate the first one
    await db.runAsync(
      `UPDATE user_buddies SET is_active = 1, updated_at = ? WHERE id = ?`,
      [now(), any.id]
    );
    return rowToUserBuddy({ ...any, is_active: 1 });
  }

  // Create starter
  const speciesId = getDefaultActiveSpecies();
  const species = getSpecies(speciesId)!;
  const formId = species.baseFormId;
  const id = randomUUID();
  const ts = now();

  await db.runAsync(
    `INSERT INTO user_buddies (
      id, user_id, species_id, nickname, current_form_id,
      level, xp, bond, is_active, unlocked_forms,
      created_at, updated_at, last_interacted_at
    ) VALUES (?, ?, ?, ?, ?, 1, 0, 10, 1, ?, ?, ?, ?)`,
    [
      id,
      userId,
      speciesId,
      null,
      formId,
      JSON.stringify([formId]),
      ts,
      ts,
      ts,
    ]
  );

  return {
    id,
    userId,
    speciesId,
    nickname: null,
    currentFormId: formId,
    level: 1,
    xp: 0,
    bond: 10,
    isActive: true,
    unlockedForms: [formId],
    createdAt: ts,
    updatedAt: ts,
    lastInteractedAt: ts,
  };
}

export async function getActiveBuddy(
  db: SQLiteDatabase,
  userId: number
): Promise<UserBuddy | null> {
  const row = await db.getFirstAsync<any>(
    `SELECT * FROM user_buddies WHERE user_id = ? AND is_active = 1 LIMIT 1`,
    [userId]
  );
  return row ? rowToUserBuddy(row) : null;
}

export async function listUserBuddies(
  db: SQLiteDatabase,
  userId: number
): Promise<UserBuddy[]> {
  const rows = await db.getAllAsync<any>(
    `SELECT * FROM user_buddies WHERE user_id = ? ORDER BY is_active DESC, updated_at DESC`,
    [userId]
  );
  return rows.map(rowToUserBuddy);
}

export async function getUserBuddy(
  db: SQLiteDatabase,
  userBuddyId: string
): Promise<UserBuddy | null> {
  const row = await db.getFirstAsync<any>(
    `SELECT * FROM user_buddies WHERE id = ?`,
    [userBuddyId]
  );
  return row ? rowToUserBuddy(row) : null;
}

/** Add XP and handle level-ups. Returns the updated buddy. */
export async function addXp(
  db: SQLiteDatabase,
  userBuddyId: string,
  amount: number
): Promise<UserBuddy> {
  const buddy = await getUserBuddy(db, userBuddyId);
  if (!buddy) throw new Error('Buddy not found');

  let { level, xp } = buddy;
  xp += amount;

  while (xp >= xpForLevel(level)) {
    xp -= xpForLevel(level);
    level += 1;
  }

  const ts = now();
  await db.runAsync(
    `UPDATE user_buddies SET level = ?, xp = ?, updated_at = ?, last_interacted_at = ? WHERE id = ?`,
    [level, xp, ts, ts, userBuddyId]
  );

  return { ...buddy, level, xp, updatedAt: ts, lastInteractedAt: ts };
}

/** Increase bond (capped at 100). */
export async function addBond(
  db: SQLiteDatabase,
  userBuddyId: string,
  amount: number
): Promise<UserBuddy> {
  const buddy = await getUserBuddy(db, userBuddyId);
  if (!buddy) throw new Error('Buddy not found');

  const bond = Math.min(100, Math.max(0, buddy.bond + amount));
  const ts = now();

  await db.runAsync(
    `UPDATE user_buddies SET bond = ?, updated_at = ?, last_interacted_at = ? WHERE id = ?`,
    [bond, ts, ts, userBuddyId]
  );

  return { ...buddy, bond, updatedAt: ts, lastInteractedAt: ts };
}

/** Attempt evolution. */
export async function tryEvolve(
  db: SQLiteDatabase,
  userBuddyId: string,
  targetFormId: string
): Promise<EvolutionResult> {
  const buddy = await getUserBuddy(db, userBuddyId);
  if (!buddy) {
    return { success: false, fromFormId: '', toFormId: targetFormId, message: 'Buddy not found' };
  }

  const currentForm = getForm(buddy.currentFormId);
  const targetForm = getForm(targetFormId);

  if (!currentForm || !targetForm) {
    return {
      success: false,
      fromFormId: buddy.currentFormId,
      toFormId: targetFormId,
      message: 'Invalid form',
    };
  }

  if (buddy.unlockedForms.includes(targetFormId)) {
    return {
      success: false,
      fromFormId: buddy.currentFormId,
      toFormId: targetFormId,
      message: 'Form already unlocked',
    };
  }

  // Check if this form is a valid next evolution
  const canEvolve =
    currentForm.evolvesTo?.includes(targetFormId) ||
    targetForm.evolvesFrom === buddy.currentFormId;

  if (!canEvolve) {
    return {
      success: false,
      fromFormId: buddy.currentFormId,
      toFormId: targetFormId,
      message: 'This evolution path is not available from current form',
    };
  }

  const req = targetForm.requirements;
  if (req) {
    if (req.level && buddy.level < req.level) {
      return {
        success: false,
        fromFormId: buddy.currentFormId,
        toFormId: targetFormId,
        message: `Need level ${req.level} (current ${buddy.level})`,
      };
    }
    if (req.bond && buddy.bond < req.bond) {
      return {
        success: false,
        fromFormId: buddy.currentFormId,
        toFormId: targetFormId,
        message: `Need bond ${req.bond}% (current ${buddy.bond}%)`,
      };
    }
    // Item checks can be added later when inventory UI is ready
  }

  // Perform evolution
  const unlocked = [...buddy.unlockedForms, targetFormId];
  const ts = now();

  await db.runAsync(
    `UPDATE user_buddies
     SET current_form_id = ?, unlocked_forms = ?, updated_at = ?, last_interacted_at = ?
     WHERE id = ?`,
    [targetFormId, JSON.stringify(unlocked), ts, ts, userBuddyId]
  );

  await db.runAsync(
    `INSERT INTO buddy_evolution_log
     (user_id, user_buddy_id, from_form_id, to_form_id, level_at, bond_at, method, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'level', ?)`,
    [buddy.userId, userBuddyId, buddy.currentFormId, targetFormId, buddy.level, buddy.bond, ts]
  );

  return {
    success: true,
    fromFormId: buddy.currentFormId,
    toFormId: targetFormId,
    message: `Evolved into ${targetForm.name}!`,
    newLevel: buddy.level,
    newBond: buddy.bond,
  };
}

export async function setActiveBuddy(
  db: SQLiteDatabase,
  userId: number,
  userBuddyId: string
): Promise<void> {
  const ts = now();
  await db.runAsync(
    `UPDATE user_buddies SET is_active = 0, updated_at = ? WHERE user_id = ?`,
    [ts, userId]
  );
  await db.runAsync(
    `UPDATE user_buddies SET is_active = 1, updated_at = ?, last_interacted_at = ? WHERE id = ? AND user_id = ?`,
    [ts, ts, userBuddyId, userId]
  );
}

export async function getInventory(
  db: SQLiteDatabase,
  userId: number
): Promise<BuddyInventoryItem[]> {
  const rows = await db.getAllAsync<any>(
    `SELECT item_id, quantity FROM buddy_inventory WHERE user_id = ? AND quantity > 0`,
    [userId]
  );
  return rows.map((r) => ({ itemId: r.item_id, quantity: r.quantity }));
}

export async function addInventoryItem(
  db: SQLiteDatabase,
  userId: number,
  itemId: string,
  quantity: number
): Promise<void> {
  const ts = now();
  await db.runAsync(
    `INSERT INTO buddy_inventory (user_id, item_id, quantity, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, item_id) DO UPDATE SET
       quantity = quantity + excluded.quantity,
       updated_at = excluded.updated_at`,
    [userId, itemId, quantity, ts]
  );
}
