import { extractDefs, extractGroup, extractInnerSvg, extractShadow, removeGroup, wrapSvg as wrapSvgCore } from '../core/xml';

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

function firstGroup(xml: string): string {
  return xml.match(/<g[\s\S]*<\/g>/i)?.[0] ?? '';
}

export function parseKikoSvgParts(xml: string): KikoSvgParts {
  const defs = extractDefs(xml);
  const tail = extractGroup(xml, 'tail-group');
  let body = extractGroup(xml, 'body-group');
  let head = extractGroup(xml, 'head-group');
  const ears = `${extractGroup(xml, 'ear-left-group')}${extractGroup(xml, 'ear-right-group')}`;
  const accessory = extractGroup(xml, 'accessory-group');
  const shadow = extractShadow(xml);

  if (head) {
    head = removeGroup(head, 'ear-left-group');
    head = removeGroup(head, 'ear-right-group');
  }

  // Fallback for assets without strict layer IDs: render whole SVG as one body layer.
  if (!body && !head && !tail) {
    body = extractInnerSvg(xml) || firstGroup(xml);
  }

  return { defs, shadow, tail, body, head, ears, accessory, raw: xml };
}

export function wrapSvg(inner: string, defs = ''): string {
  return wrapSvgCore(inner, defs);
}
