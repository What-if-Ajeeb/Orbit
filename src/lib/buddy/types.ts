/**
 * Orbit Buddy System – Type definitions
 * Pokémon-style companion progression with evolution trees,
 * bond, XP, forms (Common / Advanced / Shiny / Mythical).
 */

export type BuddyRarity = 'common' | 'advanced' | 'shiny' | 'mythical';

export type EvolutionMethod = 'level' | 'item' | 'bond' | 'event' | 'branch';

export type BuddyElement =
  | 'normal'
  | 'fire'
  | 'water'
  | 'electric'
  | 'spirit'
  | 'dark'
  | 'nature'
  | 'psychic'
  | 'ice'
  | 'metal';

export interface BuddyStats {
  power: number;
  intelligence: number;
  speed: number;
  affinity: number;
}

export interface EvolutionRequirement {
  level?: number;
  bond?: number; // 0-100
  items?: { itemId: string; quantity: number }[];
  tasksCompleted?: number;
  special?: string; // e.g. 'full_moon', 'event_id'
}

export interface BuddyForm {
  id: string; // e.g. 'fox_base', 'fox_aether', 'fox_aether_shiny'
  speciesId: string;
  name: string;
  stage: number; // 1 = base, 2, 3, 4...
  rarity: BuddyRarity;
  element: BuddyElement;
  description: string;
  stats: BuddyStats; // base stats at this form
  requirements?: EvolutionRequirement;
  evolvesFrom?: string; // form id
  evolvesTo?: string[]; // possible next form ids (for branching)
  imageKey: string; // for asset lookup / placeholder
  isDefault?: boolean;
}

export interface BuddySpecies {
  id: string; // 'fox', 'raven', 'owl'...
  name: string;
  mbti: string; // e.g. 'ENTP'
  element: BuddyElement;
  description: string;
  baseFormId: string;
  forms: BuddyForm[];
  maxStage: number;
}

export interface UserBuddy {
  id: string;
  userId: number;
  speciesId: string;
  nickname: string | null;
  currentFormId: string;
  level: number;
  xp: number;
  bond: number; // 0-100
  isActive: boolean;
  unlockedForms: string[];
  createdAt: number;
  updatedAt: number;
  lastInteractedAt: number | null;
}

export interface BuddyInventoryItem {
  itemId: string;
  quantity: number;
}

export interface EvolutionResult {
  success: boolean;
  fromFormId: string;
  toFormId: string;
  message: string;
  newLevel?: number;
  newBond?: number;
}

/** XP required to go from level N to N+1 */
export function xpForLevel(level: number): number {
  // Soft curve: 100 * level^1.45 roughly
  return Math.floor(80 + level * 45 + Math.pow(level, 1.4) * 12);
}

/** Total XP needed to reach a given level */
export function totalXpForLevel(level: number): number {
  let total = 0;
  for (let i = 1; i < level; i++) {
    total += xpForLevel(i);
  }
  return total;
}
