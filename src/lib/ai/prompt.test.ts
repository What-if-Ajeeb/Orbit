import { describe, expect, it } from 'vitest';

import { buildSystemPrompt } from './prompt';

const NOW = Date.parse('2026-11-28T10:00:00.000Z');

describe('artifact system prompt', () => {
  it('requires dependency-free artifacts while the CDN setting is off', () => {
    const prompt = buildSystemPrompt('Test', 'Master', NOW, undefined, {
      artifactCdnjsAllowed: false,
    });

    expect(prompt).toContain('dependency-free: use vanilla JavaScript, inline SVG and canvas');
    expect(prompt).toContain('No libraries, CDNs, external URLs, fetch or network calls');
    expect(prompt).toContain('window.orbit.storage.get(key)');
    expect(prompt).not.toContain('https://cdnjs.cloudflare.com');
  });

  it('names only the opted-in CDN host and keeps network access blocked', () => {
    const prompt = buildSystemPrompt('Test', 'Master', NOW, undefined, {
      artifactCdnjsAllowed: true,
    });

    expect(prompt).toContain('https://cdnjs.cloudflare.com');
    expect(prompt).toContain('may load only that exact host');
    expect(prompt).toContain('Fetch, API calls and all other network access remain blocked');
    expect(prompt).not.toContain('dependency-free: use vanilla JavaScript');
  });
});
