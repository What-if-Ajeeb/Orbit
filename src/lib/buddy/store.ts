import type { SQLiteDatabase } from 'expo-sqlite';
import { randomUUID } from 'expo-crypto';

import type { BuddyActivityLog, BuddyMood, EvolutionResult, UserBuddy } from './types';
import { canEvolveTo, getDefaultActiveSpecies, getDefaultForm, getForm } from './species';
import { grantBuddyReward } from './reward-ledger';
import { xpForLevel } from './types';

function now() { return Date.now(); }

function parseUnlockedForms(raw: string | null): string[] {
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
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
    mood: (row.mood as BuddyMood) || 'calm',
    unlockedForms: parseUnlockedForms(row.unlocked_forms),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastInteractedAt: row.last_interacted_at,
  };
}

export async function ensureStarterBuddy(db: SQLiteDatabase, userId: number): Promise<UserBuddy> {
  const existing = await db.getFirstAsync<any>(
    'SELECT * FROM user_buddies WHERE user_id = ? ORDER BY is_active DESC, created_at ASC LIMIT 1',
    [userId]
  );
  if (existing) return rowToUserBuddy(existing);

  const speciesId = getDefaultActiveSpecies();
  const form = getDefaultForm(speciesId);
  if (!form) throw new Error(`Default species ${speciesId} not found`);

  const id = randomUUID();
  const ts = now();
  await db.runAsync(
    `INSERT INTO user_buddies (id, user_id, species_id, nickname, current_form_id, level, xp, bond, is_active, mood, unlocked_forms, created_at, updated_at, last_interacted_at)
     VALUES (?, ?, ?, ?, ?, 1, 0, 10, 1, 'calm', ?, ?, ?, ?)`,
    [id, userId, speciesId, null, form.id, JSON.stringify([form.id]), ts, ts, ts]
  );
  const row = await db.getFirstAsync<any>('SELECT * FROM user_buddies WHERE id = ?', [id]);
  return rowToUserBuddy(row);
}

export async function getActiveBuddy(db: SQLiteDatabase, userId: number): Promise<UserBuddy | null> {
  const row = await db.getFirstAsync<any>(
    'SELECT * FROM user_buddies WHERE user_id = ? AND is_active = 1 LIMIT 1',
    [userId]
  );
  if (row) return rowToUserBuddy(row);
  return ensureStarterBuddy(db, userId);
}

export async function listUserBuddies(db: SQLiteDatabase, userId: number): Promise<UserBuddy[]> {
  const rows = await db.getAllAsync<any>('SELECT * FROM user_buddies WHERE user_id = ? ORDER BY is_active DESC, created_at ASC', [userId]);
  return rows.map(rowToUserBuddy);
}

export async function getUserBuddy(db: SQLiteDatabase, userId: number, buddyId: string): Promise<UserBuddy | null> {
  const row = await db.getFirstAsync<any>('SELECT * FROM user_buddies WHERE id = ? AND user_id = ? LIMIT 1', [buddyId, userId]);
  return row ? rowToUserBuddy(row) : null;
}

export async function setActiveBuddy(db: SQLiteDatabase, userId: number, buddyId: string): Promise<void> {
  const ts = now();
  await db.runAsync('UPDATE user_buddies SET is_active = 0, updated_at = ? WHERE user_id = ?', [ts, userId]);
  await db.runAsync('UPDATE user_buddies SET is_active = 1, updated_at = ?, last_interacted_at = ? WHERE id = ? AND user_id = ?', [ts, ts, buddyId, userId]);
}

export async function addXp(db: SQLiteDatabase, userId: number, buddyId: string, amount: number): Promise<{ buddy: UserBuddy; leveledUp: boolean; previousLevel: number }> {
  const buddy = await getUserBuddy(db, userId, buddyId);
  if (!buddy) throw new Error('Buddy not found');
  const previousLevel = buddy.level;
  let xp = buddy.xp + Math.max(0, amount);
  let level = buddy.level;
  while (xp >= xpForLevel(level) && level < 99) level += 1;
  const ts = now();
  await db.runAsync('UPDATE user_buddies SET xp = ?, level = ?, updated_at = ?, last_interacted_at = ? WHERE id = ? AND user_id = ?', [xp, level, ts, ts, buddyId, userId]);
  const updated = (await getUserBuddy(db, userId, buddyId))!;
  return { buddy: updated, leveledUp: level > previousLevel, previousLevel };
}

export async function addBond(db: SQLiteDatabase, userId: number, buddyId: string, amount: number): Promise<UserBuddy> {
  const buddy = await getUserBuddy(db, userId, buddyId);
  if (!buddy) throw new Error('Buddy not found');
  const bond = Math.min(100, Math.max(0, buddy.bond + amount));
  const ts = now();
  await db.runAsync('UPDATE user_buddies SET bond = ?, updated_at = ?, last_interacted_at = ? WHERE id = ? AND user_id = ?', [bond, ts, ts, buddyId, userId]);
  return (await getUserBuddy(db, userId, buddyId))!;
}

export async function setBuddyMood(db: SQLiteDatabase, userId: number, buddyId: string, mood: BuddyMood): Promise<UserBuddy> {
  const ts = now();
  await db.runAsync('UPDATE user_buddies SET mood = ?, updated_at = ?, last_interacted_at = ? WHERE id = ? AND user_id = ?', [mood, ts, ts, buddyId, userId]);
  const buddy = await getUserBuddy(db, userId, buddyId);
  if (!buddy) throw new Error('Buddy not found');
  return buddy;
}

export async function logBuddyActivity(db: SQLiteDatabase, userId: number, buddyId: string, activity: string, xpGained = 0, bondGained = 0): Promise<void> {
  await db.runAsync(
    'INSERT INTO buddy_activity_log (user_id, user_buddy_id, activity, xp_gained, bond_gained, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [userId, buddyId, activity, xpGained, bondGained, now()]
  );
}

export async function listBuddyActivities(db: SQLiteDatabase, userId: number, buddyId: string, limit = 20): Promise<BuddyActivityLog[]> {
  const rows = await db.getAllAsync<any>(
    'SELECT * FROM buddy_activity_log WHERE user_id = ? AND user_buddy_id = ? ORDER BY created_at DESC LIMIT ?',
    [userId, buddyId, limit]
  );
  return rows.map((r) => ({ id: r.id, userId: r.user_id, userBuddyId: r.user_buddy_id, activity: r.activity, xpGained: r.xp_gained, bondGained: r.bond_gained, createdAt: r.created_at }));
}

export async function getInventory(db: SQLiteDatabase, userId: number): Promise<{ itemId: string; quantity: number }[]> {
  const rows = await db.getAllAsync<any>('SELECT item_id, quantity FROM buddy_inventory WHERE user_id = ?', [userId]);
  return rows.map((r) => ({ itemId: r.item_id, quantity: r.quantity }));
}

export async function addInventoryItem(db: SQLiteDatabase, userId: number, itemId: string, qty: number): Promise<void> {
  const existing = await db.getFirstAsync<any>('SELECT id, quantity FROM buddy_inventory WHERE user_id = ? AND item_id = ?', [userId, itemId]);
  const ts = now();
  if (existing) {
    await db.runAsync('UPDATE buddy_inventory SET quantity = ?, updated_at = ? WHERE id = ?', [existing.quantity + qty, ts, existing.id]);
  } else {
    await db.runAsync('INSERT INTO buddy_inventory (user_id, item_id, quantity, updated_at) VALUES (?, ?, ?, ?)', [userId, itemId, qty, ts]);
  }
}

export async function tryEvolve(db: SQLiteDatabase, userId: number, buddyId: string, targetFormId: string): Promise<EvolutionResult> {
  const buddy = await getUserBuddy(db, userId, buddyId);
  if (!buddy) return { ok: false, error: 'Buddy not found' };
  const currentForm = getForm(buddy.currentFormId);
  const target = getForm(targetFormId);
  if (!currentForm || !target) return { ok: false, error: 'Unknown form' };
  if (target.speciesId !== buddy.speciesId) return { ok: false, error: 'Form does not belong to this species' };
  if (currentForm.evolvesTo && !currentForm.evolvesTo.includes(targetFormId)) {
    return { ok: false, error: `${currentForm.name} cannot evolve into ${target.name}` };
  }
  const inv = await getInventory(db, userId);
  const check = canEvolveTo(buddy, target, inv);
  if (!check.ok) return { ok: true, evolved: false, reason: check.missing.join(', ') };

  const method = target.requirements?.items?.length
    ? 'item'
    : target.requirements?.bond && buddy.bond >= target.requirements.bond && !target.requirements.level
      ? 'bond'
      : target.requirements?.level && buddy.level >= target.requirements.level
        ? 'level'
        : 'event';

  const ts = now();
  await db.withTransactionAsync(async () => {
    if (target.requirements?.items) {
      for (const it of target.requirements.items) {
        await addInventoryItem(db, userId, it.itemId, -it.quantity);
      }
    }
    const unlocked = Array.from(new Set([...buddy.unlockedForms, targetFormId]));
    await db.runAsync(
      'UPDATE user_buddies SET current_form_id = ?, unlocked_forms = ?, updated_at = ?, last_interacted_at = ?, mood = ? WHERE id = ? AND user_id = ?',
      [targetFormId, JSON.stringify(unlocked), ts, ts, 'excited', buddyId, userId]
    );
    await db.runAsync(
      'INSERT INTO buddy_evolution_log (user_id, user_buddy_id, from_form_id, to_form_id, level_at, bond_at, method, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [userId, buddyId, currentForm.id, target.id, buddy.level, buddy.bond, method, ts]
    );
  });

  // Ledger-backed so replaying the same evolution cannot award XP again.
  await grantBuddyReward(db, userId, buddyId, 'evolutionBonus', targetFormId, ts);
  const updated = (await getUserBuddy(db, userId, buddyId))!;
  return { ok: true, evolved: true, from: currentForm, to: target, buddy: updated };
}
