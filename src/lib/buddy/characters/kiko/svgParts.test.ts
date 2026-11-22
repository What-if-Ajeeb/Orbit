import { describe, expect, it } from 'vitest';

import { parseKikoSvgParts, wrapSvg } from './svgParts';

const layered = `<svg viewBox="0 0 320 320"><defs><linearGradient id="g"/></defs><g id="kiko-root"><ellipse id="shadow" cx="1" cy="1" rx="1" ry="1"/><g id="tail-group"><path id="tail"/></g><g id="body-group"><path id="body"/></g><g id="head-group"><g id="ear-left-group"></g><g id="ear-right-group"></g><g id="eyes-group"></g><path id="mouth"/></g><g id="accessory-group"></g></g></svg>`;

describe('kiko svg parts', () => {
  it('extracts layered groups and removes ear duplicates from head', () => {
    const p = parseKikoSvgParts(layered);
    expect(p.defs).toContain('<defs');
    expect(p.tail).toContain('tail-group');
    expect(p.body).toContain('body-group');
    expect(p.head).toContain('head-group');
    expect(p.head).not.toContain('ear-left-group');
    expect(p.ears).toContain('ear-left-group');
    expect(p.accessory).toContain('accessory-group');
  });

  it('falls back to whole inner svg when no strict layers exist', () => {
    const p = parseKikoSvgParts('<svg viewBox="0 0 320 320"><circle id="only" cx="1" cy="1" r="1"/></svg>');
    expect(p.body).toContain('circle');
    expect(p.head).toBe('');
  });

  it('wrapSvg produces svg shell', () => {
    expect(wrapSvg('<g/>', '<defs/>')).toContain('<svg');
    expect(wrapSvg('<g/>', '<defs/>')).toContain('<defs/>');
  });
});
