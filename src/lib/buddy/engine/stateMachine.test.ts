import { describe, expect, it } from 'vitest';

import { canInterrupt, fallbackState, moodToAnimation, transition } from './stateMachine';

describe('buddy state machine', () => {
  it('handles tap/double/long/blink transitions', () => {
    expect(transition('idle', { type: 'TAP' })).toBe('tapped');
    expect(transition('idle', { type: 'DOUBLE_TAP' })).toBe('double-tapped');
    expect(transition('idle', { type: 'LONG_PRESS' })).toBe('long-pressed');
    expect(transition('idle', { type: 'BLINK' })).toBe('blink');
    expect(fallbackState('blink')).toBe('idle');
  });

  it('supports speaking priority and voice end fallback', () => {
    expect(transition('walking', { type: 'VOICE_START' })).toBe('speaking');
    expect(transition('speaking', { type: 'VOICE_END' })).toBe('idle');
    expect(canInterrupt('speaking', 'petting')).toBe(false);
    expect(canInterrupt('speaking', 'celebrating')).toBe(true);
  });

  it('handles working/waiting/celebrating', () => {
    expect(transition('idle', { type: 'WORKING' })).toBe('working');
    expect(transition('working', { type: 'WAITING_APPROVAL' })).toBe('waiting');
    expect(transition('working', { type: 'TASK_SUCCESS' })).toBe('celebrating');
  });

  it('maps moods and falls back safely', () => {
    expect(moodToAnimation('sleepy')).toBe('sleeping');
    expect(moodToAnimation('excited')).toBe('celebrating');
    expect(fallbackState('petting')).toBe('idle');
    expect(fallbackState('working')).toBe('waiting');
  });

  it('interrupts lower-priority transient states appropriately', () => {
    expect(transition('tapped', { type: 'SET', state: 'celebrating' })).toBe('celebrating');
    expect(transition('celebrating', { type: 'SET', state: 'tapped' })).toBe('tapped');
  });
});
