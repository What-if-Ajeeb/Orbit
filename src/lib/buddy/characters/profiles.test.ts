import { describe, expect, it } from 'vitest';

import { ALL_SPECIES_IDS } from '../species';
import type { BuddyAnimationState } from '../types';
import { ALL_CHARACTER_IDS, BUDDY_CHARACTER_PROFILES, getBuddyCharacterProfile } from './profiles';

const EVENT_TYPES = [
  'task_created',
  'task_started',
  'task_progress',
  'tool_started',
  'tool_completed',
  'approval_required',
  'task_waiting',
  'task_completed',
  'task_failed',
  'agent_idle',
  'user_interaction',
];

const ANIMATION_STATES: BuddyAnimationState[] = [
  'idle',
  'blink',
  'happy',
  'sad',
  'angry',
  'curious',
  'thinking',
  'speaking',
  'sleeping',
  'walking',
  'jumping',
  'celebrating',
  'tapped',
  'double-tapped',
  'long-pressed',
  'petting',
  'feeding',
  'playing',
  'working',
  'waiting',
  'concerned',
];

describe('Buddy character identity profiles', () => {
  it('preserves all sixteen canonical characters including Kiko', () => {
    expect(BUDDY_CHARACTER_PROFILES).toHaveLength(16);
    expect(ALL_CHARACTER_IDS).toEqual(ALL_SPECIES_IDS);
    expect(ALL_CHARACTER_IDS).toContain('fox');
    expect(ALL_CHARACTER_IDS).toContain('raven');
    expect(new Set(ALL_CHARACTER_IDS).size).toBe(16);
  });

  it.each(BUDDY_CHARACTER_PROFILES)('$characterId has complete personality data', (profile) => {
    expect(profile.mbti).toMatch(/^[EI][SN][TF][JP]$/);
    expect(['NT', 'NF', 'SJ', 'SP']).toContain(profile.personalityGroup);
    expect(profile.species).toBeTruthy();
    expect(profile.description.length).toBeGreaterThan(10);
    expect(profile.communicationStyle.length).toBeGreaterThan(3);

    for (const state of ANIMATION_STATES) {
      expect(profile.expressionMap[state], `${profile.characterId} missing ${state}`).toBeTruthy();
    }
    for (const eventType of EVENT_TYPES) {
      const key = eventType as keyof typeof profile.reactionTemplates;
      expect(profile.reactionTemplates[key]?.length, `${profile.characterId} missing ${eventType}`).toBeGreaterThan(0);
      expect(profile.animationMap[key], `${profile.characterId} missing animation for ${eventType}`).toBeTruthy();
    }

    for (const [attribute, value] of Object.entries(profile.attributes)) {
      expect(attribute).toBeTruthy();
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(10);
    }
    expect(profile.assetProfile.renderer).toBe(profile.speciesId === 'fox' ? 'kiko' : 'rig');
  });

  it('falls back to a valid profile for unknown species', () => {
    const fallback = getBuddyCharacterProfile('not-a-character');
    expect(fallback.characterId).toBe('fox');
    expect(fallback.reactionTemplates.task_completed.length).toBeGreaterThan(0);
  });
});
