/**
 * Small, dependency-free SVG helpers used by the asset-driven Buddy rigs.
 *
 * Buddy SVG assets follow a stable layer contract:
 *   shadow (ellipse#shadow), body-group, head-group (with ear-*-group,
 *   eyes-group, mouth-* groups) and optional appendage groups.
 *
 * All extraction is nesting-aware: a naive `<g ...>...</g>` regex breaks as
 * soon as a layer contains nested groups, which the character heads do.
 */

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Extract a complete `<g id="...">...</g>` block, including nested groups. */
export function extractGroup(xml: string, id: string): string {
  const opener = new RegExp(`<g\\b[^>]*\\bid="${escapeRegExp(id)}"[^>]*>`);
  const match = opener.exec(xml);
  if (!match) return '';

  const start = match.index;
  let depth = 1;
  const tagRe = /<g\b[^>]*>|<\/g\s*>/g;
  tagRe.lastIndex = start + match[0].length;

  let next: RegExpExecArray | null;
  while ((next = tagRe.exec(xml))) {
    if (next[0].startsWith('</g')) depth -= 1;
    else depth += 1;
    if (depth === 0) {
      return xml.slice(start, next.index + next[0].length);
    }
  }
  return '';
}

export function removeGroup(xml: string, id: string): string {
  const group = extractGroup(xml, id);
  return group ? xml.replace(group, '') : xml;
}

export function extractDefs(xml: string): string {
  return xml.match(/<defs[\s\S]*?<\/defs>/i)?.[0] ?? '';
}

export function extractShadow(xml: string): string {
  const ellipse = xml.match(/<ellipse\b[^>]*\bid="shadow"[^>]*\/?>(?:<\/ellipse>)?/i);
  if (ellipse) return ellipse[0];
  const path = xml.match(/<path\b[^>]*\bid="shadow"[^>]*\/?>/i);
  return path?.[0] ?? '';
}

export function wrapSvg(inner: string, defs = '', viewBox = '0 0 320 320'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none">${defs}${inner}</svg>`;
}

export function extractInnerSvg(xml: string): string {
  return xml
    .replace(/^[\s\S]*?<svg\b[^>]*>/i, '')
    .replace(/<\/svg\s*>\s*$/i, '')
    .replace(/<defs[\s\S]*?<\/defs>/i, '');
}

/**
 * Show/hide an element by id using the SVG `display` attribute. Works for
 * both `<g>` and `<path>` elements and tolerates elements without display.
 */
export function setDisplay(xml: string, id: string, visible: boolean): string {
  const tagRe = new RegExp(`<([a-zA-Z]+)\\b[^>]*\\bid="${escapeRegExp(id)}"[^>]*>`, 'g');
  return xml.replace(tagRe, (tag) => {
    const cleaned = tag.replace(/\sdisplay="[^"]*"/i, '');
    return visible ? cleaned : cleaned.replace(/>$/, ' display="none">');
  });
}

export function hasGroup(xml: string, id: string): boolean {
  return new RegExp(`<g\\b[^>]*\\bid="${escapeRegExp(id)}"`).test(xml);
}
