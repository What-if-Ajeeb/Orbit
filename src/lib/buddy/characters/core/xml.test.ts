import { describe, expect, it } from 'vitest';

import { extractDefs, extractGroup, extractShadow, setDisplay, wrapSvg } from './xml';

const nested = `<svg viewBox="0 0 320 320">
  <defs><linearGradient id="fur"/></defs>
  <g id="head-group">
    <g id="ear-left-group"><path id="ear-left"/></g>
    <g id="eyes-group">
      <g id="eyes-open"><path id="eye"/></g>
      <g id="eyes-closed" display="none"><path id="closed"/></g>
    </g>
    <g id="ear-right-group"><path id="ear-right"/></g>
  </g>
  <g id="body-group"><path id="body"/></g>
  <ellipse id="shadow" cx="1" cy="1" rx="1" ry="1"/>
</svg>`;

describe('character xml helpers', () => {
  it('extracts nested groups without truncating them', () => {
    const head = extractGroup(nested, 'head-group');
    expect(head).toContain('eyes-group');
    expect(head).toContain('ear-right-group');
    expect(head).toContain('</g>');
    expect(extractGroup(nested, 'eyes-group')).toContain('eyes-closed');
  });

  it('extracts defs and shadow', () => {
    expect(extractDefs(nested)).toContain('linearGradient');
    expect(extractShadow(nested)).toContain('<ellipse');
  });

  it('toggles display for nested ids without touching siblings', () => {
    const closed = setDisplay(nested, 'eyes-closed', true);
    expect(closed).toMatch(/<g id="eyes-closed">/);
    const open = setDisplay(nested, 'eyes-open', false);
    expect(open).toMatch(/<g id="eyes-open" display="none">/);
    expect(open).toMatch(/<g id="eyes-closed" display="none">/);
  });

  it('wraps a layer in a valid svg shell', () => {
    expect(wrapSvg('<g/>', '<defs/>')).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" fill="none"><defs/><g/></svg>'
    );
  });
});
