import { describe, expect, it } from 'vitest';

import { getPersonality } from '../personality';
import { getDefaultForm, getSpecies } from '../species';
import type { BuddyAnimationState } from '../types';
import { getAllCharacterRigs } from './rigs';

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

const rigs = getAllCharacterRigs();

describe('buddy character roster', () => {
  it('registers all fifteen remaining species once', () => {
    expect(rigs).toHaveLength(15);
    expect(new Set(rigs.map((rig) => rig.speciesId)).size).toBe(15);
    expect(rigs.map((rig) => rig.speciesId).sort()).toEqual([
      'bear',
      'beaver',
      'cat',
      'cheetah',
      'deer',
      'dolphin',
      'elephant',
      'golden-retriever',
      'labrador',
      'lion',
      'owl',
      'panda',
      'parrot',
      'raven',
      'wolf',
    ]);
  });
});

describe.each(rigs)('$displayName rig', (rig) => {
  it('registers the canonical personality profile', () => {
    expect(rig.personality).toEqual(getPersonality(rig.speciesId));
    expect(rig.personality.greeting.length).toBeGreaterThan(0);
  });

  it('maps every species form to an original asset and falls back to base', () => {
    const species = getSpecies(rig.speciesId);
    expect(species).toBeDefined();
    const formKeys = Object.keys(rig.assets)
      .filter((key) => key.startsWith(`${rig.speciesId}_`))
      .sort();
    expect(formKeys).toEqual(species!.forms.map((form) => form.id).sort());
    expect(rig.baseFormId).toBe(getDefaultForm(rig.speciesId)?.id);

    for (const form of species!.forms) {
      expect(rig.assets[form.id]).toBeGreaterThan(0);
      expect(rig.resolveFormKey?.(form.id)).toBe(form.id);
    }
    expect(rig.resolveFormKey?.(undefined)).toBe(rig.baseFormId);
    expect(rig.resolveFormKey?.('not_a_real_form')).toBe(rig.baseFormId);
  });

  it('registers anatomy-aware animation definitions', () => {
    expect(rig.appendages.length).toBeGreaterThan(0);
    expect(new Set(rig.appendages.map((appendage) => appendage.id)).size).toBe(rig.appendages.length);
    for (const appendage of rig.appendages) {
      expect(appendage.amplitude).toBeGreaterThan(0);
      expect(appendage.duration).toBeGreaterThanOrEqual(180);
      expect(appendage.pivot?.x).toBeGreaterThan(0);
      expect(appendage.pivot?.y).toBeGreaterThan(0);
    }
    expect(rig.motion.breath).toBeGreaterThan(0);
    expect(rig.motion.sway).toBeGreaterThan(0);
    expect(rig.motion.headTilt).toBeGreaterThan(0);
  });

  it('registers an expression mapping for every animation state', () => {
    expect(rig.expressions.eyes.open).toBe('eyes-open');
    expect(rig.expressions.eyes.closed).toBe('eyes-closed');
    expect(rig.expressions.eyes.thinking).toBe('eyes-thinking');
    for (const state of ANIMATION_STATES) {
      expect(rig.expressions.mouths[state], `${rig.speciesId} missing ${state}`).toBeTruthy();
    }
    expect(rig.expressions.blush).toBeTruthy();
    expect(rig.expressions.sweat).toBeTruthy();
    expect(rig.expressions.sparkle).toBeTruthy();
  });

  it('registers tap, double-tap, long-press and petting interactions', () => {
    expect(rig.interactions).toEqual({
      tap: 'tapped',
      doubleTap: 'double-tapped',
      longPress: 'long-pressed',
      pet: 'petting',
    });
  });
});
