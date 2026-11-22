export type KikoSvgParts = {
  defs: string;
  shadow: string;
  tail: string;
  body: string;
  head: string;
  ears: string;
  accessory: string;
  raw: string;
};

function extractGroup(xml: string, id: string): string {
  const re = new RegExp(`<g id="${id}"[\\s\\S]*?<\\/g>`, 'i');
  return xml.match(re)?.[0] ?? '';
}
function extractTag(xml: string, id: string, tag = 'path|ellipse|circle|g'): string {
  const re = new RegExp(`<(${tag})[^>]*id="${id}"[\\s\\S]*?(?:\\/>|<\\/\\1>)`, 'i');
  return xml.match(re)?.[0] ?? '';
}
function removeGroup(xml: string, id: string): string {
  const re = new RegExp(`<g id="${id}"[\\s\\S]*?<\\/g>`, 'i');
  return xml.replace(re, '');
}
function firstGroup(xml: string): string {
  return xml.match(/<g[\s\S]*<\/g>/i)?.[0] ?? '';
}

export function parseKikoSvgParts(xml: string): KikoSvgParts {
  const defsMatch = xml.match(/<defs[\s\S]*?<\/defs>/i);
  const tail = extractGroup(xml, 'tail-group') || extractTag(xml, 'tail', 'path');
  let body = extractGroup(xml, 'body-group');
  let head = extractGroup(xml, 'head-group');
  const ears = `${extractGroup(xml, 'ear-left-group')}${extractGroup(xml, 'ear-right-group')}`;
  const accessory = extractGroup(xml, 'accessory-group');
  const shadow = extractTag(xml, 'shadow', 'ellipse');

  if (head) {
    head = removeGroup(head, 'ear-left-group');
    head = removeGroup(head, 'ear-right-group');
  }

  // Fallback for assets without strict layer IDs: render whole SVG as a single body layer.
  if (!body && !head && !tail) {
    const inner = xml.replace(/^[\s\S]*?<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '').replace(/<defs[\s\S]*?<\/defs>/i, '');
    body = inner || firstGroup(xml);
  }

  return { defs: defsMatch?.[0] ?? '', shadow, tail, body, head, ears, accessory, raw: xml };
}

export function wrapSvg(inner: string, defs = ''): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" fill="none">${defs}${inner}</svg>`;
}
