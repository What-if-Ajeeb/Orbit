import type { CharacterRig, CharacterSvgParts, ExpressionMapping } from './types';
import { DEFAULT_EXPRESSIONS } from './types';
import { extractDefs, extractGroup, extractShadow, setDisplay } from './xml';
export function parseCharacterSvg(xml: string, rig: CharacterRig): CharacterSvgParts {
  const headRaw = extractGroup(xml, 'head-group');
  const ears = `${extractGroup(xml, 'ear-left-group')}${extractGroup(xml, 'ear-right-group')}`;
  const head = headRaw
    .replace(extractGroup(headRaw, 'ear-left-group'), '')
    .replace(extractGroup(headRaw, 'ear-right-group'), '');

  const appendages: Record<string, string> = {};
  for (const appendage of rig.appendages) {
    appendages[appendage.id] = extractGroup(xml, appendage.id);
  }

  return {
    defs: extractDefs(xml),
    shadow: extractShadow(xml),
    body: extractGroup(xml, 'body-group'),
    head,
    ears,
    accessory: extractGroup(xml, 'accessory-group'),
    appendages,
    raw: xml,
  };
}

export function hasLayerContract(xml: string): boolean {
  return ['body-group', 'head-group', 'eyes-open', 'eyes-closed', 'mouth-idle'].every((id) =>
    xml.includes(`id="${id}"`)
  );
}

export type ExpressionOptions = {
  state: string;
  speaking?: boolean;
  blink?: boolean;
  mapping?: ExpressionMapping;
};

/**
 * Toggle the expression groups present in a character head layer. Every asset
 * ships all variants with `display="none"` except the idle ones, so this works
 * without runtime path rewriting or recolouring.
 */
export function applyExpression(
  headXml: string,
  { state, speaking = false, blink = false, mapping = DEFAULT_EXPRESSIONS }: ExpressionOptions
): string {
  let out = headXml;
  const closed = blink || state === 'sleeping';
  const eyeVariant = closed ? mapping.eyes.closed : ['thinking', 'curious', 'working', 'waiting'].includes(state) ? mapping.eyes.thinking : mapping.eyes.open;
  const mouthVariant = speaking ? mapping.mouths.speaking : mapping.mouths[state] ?? mapping.mouths.idle;

  for (const id of [mapping.eyes.open, mapping.eyes.closed, mapping.eyes.thinking]) {
    out = setDisplay(out, id, id === eyeVariant);
  }

  const mouthIds = new Set([...Object.values(DEFAULT_EXPRESSIONS.mouths), ...Object.values(mapping.mouths), 'mouth-idle']);
  for (const id of mouthIds) {
    out = setDisplay(out, id, id === mouthVariant);
  }

  // Optional character flourishes (blush, sweat drop, sparkles, etc.).
  const expressive = ['happy', 'celebrating', 'playing', 'petting'].includes(state);
  out = setDisplay(out, mapping.blush, expressive);
  out = setDisplay(out, mapping.sweat, state === 'concerned' || state === 'sad');
  out = setDisplay(out, mapping.sparkle, state === 'celebrating');
  return out;
}
