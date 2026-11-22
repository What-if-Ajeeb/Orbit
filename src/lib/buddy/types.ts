/**
 * Orbit Buddy System – Type definitions
 * Data-driven companion system: species, forms, personality, animations,
 * evolution, activities, and AI integration.
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
  | 'metal'
  | 'air'
  | 'light';

export type BuddyGroup = 'NT' | 'NF' | 'SJ' | 'SP';

export type BuddyMood = 'calm' | 'happy' | 'curious' | 'sleepy' | 'focused' | 'sad' | 'excited';

export type BuddyAnimationState =
  | 'idle'
  | 'blink'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'curious'
  | 'thinking'
  | 'speaking'
  | 'sleeping'
  | 'walking'
  | 'jumping'
  | 'celebrating'
  | 'tapped'
  | 'double-tapped'
  | 'long-pressed'
  | 'petting'
  | 'feeding'
  | 'playing'
  | 'working'
  | 'waiting'
  | 'concerned';

export interface BuddyStats {
  power: number;
  intelligence: number;
  speed: number;
  affinity: number;
}

export interface PersonalityProfile {
  intelligence: number;
  friendliness: number;
  curiosity: number;
  playfulness: number;
  emotionalSensitivity: number;
  confidence: number;
  energy: number;
  humor: number;
  greeting: string;
  conversationStyle: string;
  encouragement: string;
  comfort: string;
  teasing: string;
  favoriteActivities: string[];
  voiceStyle: string;
}

export interface EvolutionRequirement {
  level?: number;
  bond?: number; // 0-100
  items?: { itemId: string; quantity: number }[];
  tasksCompleted?: number;
  special?: string;
}

export interface BuddyForm {
  id: string;
  speciesId: string;
  name: string;
  stage: number;
  rarity: BuddyRarity;
  element: BuddyElement;
  description: string;
  stats: BuddyStats;
  requirements?: EvolutionRequirement;
  evolvesFrom?: string;
  evolvesTo?: string[];
  imageKey: string;
  isDefault?: boolean;
}

export interface BuddySpecies {
  id: string;
  name: string;
  mbti: string;
  group: BuddyGroup;
  element: BuddyElement;
  description: string;
  personality: PersonalityProfile;
  forms: BuddyForm[];
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
  mood: BuddyMood;
  unlockedForms: string[];
  createdAt: number;
  updatedAt: number;
  lastInteractedAt: number | null;
}

export interface BuddyInventoryItem {
  id: number;
  userId: number;
  itemId: string;
  quantity: number;
}

export interface BuddyActivityLog {
  id: number;
  userId: number;
  userBuddyId: string;
  activity: string;
  xpGained: number;
  bondGained: number;
  createdAt: number;
}

export type EvolutionResult =
  | { ok: true; evolved: true; from: BuddyForm; to: BuddyForm; buddy: UserBuddy }
  | { ok: true; evolved: false; reason: string }
  | { ok: false; error: string };

export function xpForLevel(level: number): number {
  return Math.floor(100 * Math.pow(level, 1.5));
}

export function xpProgress(xp: number, level: number): { current: number; needed: number; pct: number } {
  const prev = level <= 1 ? 0 : xpForLevel(level - 1);
  const next = xpForLevel(level);
  const current = Math.max(0, xp - prev);
  const needed = Math.max(1, next - prev);
  return { current, needed, pct: Math.min(1, current / needed) };
}
