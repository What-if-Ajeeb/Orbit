import { describe, expect, it } from 'vitest';
import { canInterrupt, fallbackState, transition } from './stateMachine';

describe('stateMachine more', () => {
  it('speaking can be interrupted by idle/waiting/concerned/celebrating', () => {
    expect(canInterrupt('speaking', 'idle')).toBe(true);
    expect(canInterrupt('speaking', 'waiting')).toBe(true);
    expect(canInterrupt('speaking', 'concerned')).toBe(true);
    expect(canInterrupt('speaking', 'celebrating')).toBe(true);
    expect(canInterrupt('speaking', 'petting')).toBe(false);
  });

  it('working protects against low-priority interruptions', () => {
    expect(canInterrupt('working', 'petting')).toBe(false);
    expect(canInterrupt('working', 'waiting')).toBe(true);
    expect(transition('working', { type: 'PET' })).toBe('working');
  });

  it('fallback states are safe', () => {
    expect(fallbackState('feeding')).toBe('idle');
    expect(fallbackState('speaking')).toBe('waiting');
    expect(fallbackState('working')).toBe('waiting');
  });
});
