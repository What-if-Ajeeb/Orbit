import type { BuddyAnimationState, BuddyMood } from '../types';

export type BuddyAnimationEvent =
  | { type: 'SET'; state: BuddyAnimationState }
  | { type: 'MOOD'; mood: BuddyMood }
  | { type: 'TAP' }
  | { type: 'DOUBLE_TAP' }
  | { type: 'LONG_PRESS' }
  | { type: 'PET' }
  | { type: 'FEED' }
  | { type: 'PLAY' }
  | { type: 'BLINK' }
  | { type: 'VOICE_START' }
  | { type: 'VOICE_END' }
  | { type: 'TASK_SUCCESS' }
  | { type: 'TASK_ERROR' }
  | { type: 'WORKING' }
  | { type: 'WAITING_APPROVAL' };

export const TRANSIENT_MS: Partial<Record<BuddyAnimationState, number>> = {
  tapped: 900,
  'double-tapped': 1100,
  'long-pressed': 1200,
  petting: 1500,
  feeding: 1600,
  playing: 1800,
  celebrating: 1800,
  jumping: 900,
  blink: 180,
};

// Higher wins interruption conflicts. Transient reactions can interrupt most states; speaking/working/waiting are protected.
export const STATE_PRIORITY: Record<BuddyAnimationState, number> = {
  idle: 10,
  blink: 15,
  walking: 20,
  sleeping: 20,
  curious: 25,
  happy: 30,
  sad: 30,
  angry: 30,
  thinking: 35,
  waiting: 40,
  playing: 45,
  petting: 45,
  feeding: 45,
  tapped: 50,
  'double-tapped': 50,
  'long-pressed': 50,
  jumping: 55,
  concerned: 60,
  celebrating: 70,
  working: 80,
  speaking: 90,
};

const INTERRUPTIBLE = new Set<BuddyAnimationState>([
  'idle', 'blink', 'happy', 'sad', 'angry', 'curious', 'thinking', 'sleeping', 'walking', 'waiting', 'concerned', 'celebrating', 'playing', 'petting', 'feeding', 'jumping', 'tapped', 'double-tapped', 'long-pressed',
]);

export function isTransient(state: BuddyAnimationState): boolean {
  return state in TRANSIENT_MS;
}

export function transientMs(state: BuddyAnimationState): number {
  return TRANSIENT_MS[state] ?? 0;
}

export function canInterrupt(current: BuddyAnimationState, next: BuddyAnimationState): boolean {
  if (current === next) return true;
  if (next === 'speaking') return true;
  if (current === 'speaking') return ['idle', 'waiting', 'concerned', 'celebrating'].includes(next);
  if (current === 'working') return ['idle', 'waiting', 'concerned', 'celebrating', 'speaking'].includes(next);
  if (STATE_PRIORITY[next] >= STATE_PRIORITY[current]) return true;
  return INTERRUPTIBLE.has(current);
}

export function moodToAnimation(mood: BuddyMood): BuddyAnimationState {
  switch (mood) {
    case 'happy': return 'happy';
    case 'curious': return 'curious';
    case 'sleepy': return 'sleeping';
    case 'focused': return 'thinking';
    case 'sad': return 'sad';
    case 'excited': return 'celebrating';
    default: return 'idle';
  }
}

export function transition(current: BuddyAnimationState, event: BuddyAnimationEvent): BuddyAnimationState {
  let next: BuddyAnimationState = current;
  switch (event.type) {
    case 'SET': next = event.state; break;
    case 'MOOD': next = moodToAnimation(event.mood); break;
    case 'TAP': next = 'tapped'; break;
    case 'DOUBLE_TAP': next = 'double-tapped'; break;
    case 'LONG_PRESS': next = 'long-pressed'; break;
    case 'PET': next = 'petting'; break;
    case 'FEED': next = 'feeding'; break;
    case 'PLAY': next = 'playing'; break;
    case 'BLINK': next = 'blink'; break;
    case 'VOICE_START': next = 'speaking'; break;
    case 'VOICE_END': next = 'idle'; break;
    case 'TASK_SUCCESS': next = 'celebrating'; break;
    case 'TASK_ERROR': next = 'concerned'; break;
    case 'WORKING': next = 'working'; break;
    case 'WAITING_APPROVAL': next = 'waiting'; break;
  }
  return canInterrupt(current, next) ? next : current;
}

export function fallbackState(state: BuddyAnimationState): BuddyAnimationState {
  if (isTransient(state)) return 'idle';
  if (state === 'speaking' || state === 'working') return 'waiting';
  return 'idle';
}
