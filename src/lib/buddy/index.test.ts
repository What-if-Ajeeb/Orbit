import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

describe('Buddy public barrel', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');

  it('exports the typed read-only subscription surface', () => {
    expect(source).toContain("from './events'");
    expect(source).toContain('subscribeBuddyEvents');
  });

  it('does not export the internal event publisher or test reset', () => {
    expect(source).not.toMatch(/export\s*\{[^}]*publishBuddyEvent/s);
    expect(source).not.toMatch(/export\s*\*\s*from\s*'\.\/events'/);
    expect(source).not.toContain('resetBuddyEventBus');
  });
});
