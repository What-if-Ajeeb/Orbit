import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { getSpecies } from '../species';
import type { CharacterRig } from './core/types';
import { DEFAULT_EXPRESSIONS } from './core/types';
import { createSvgLoader } from './core/loader';
import { applyExpression, parseCharacterSvg } from './core/parts';
import { getAllCharacterRigs } from './rigs';

const CHARACTER_ROOT = path.resolve(process.cwd(), 'orbit-buddy/characters');
const rigs = getAllCharacterRigs();

function assetFileForForm(speciesId: string, key: string): string {
  if (key === 'expressions') return path.join(CHARACTER_ROOT, speciesId, 'expressions.svg');
  if (key === 'animations') return path.join(CHARACTER_ROOT, speciesId, 'animations.svg');
  if (key === `${speciesId}_base`) return path.join(CHARACTER_ROOT, speciesId, 'base.svg');
  if (key === `${speciesId}_stage2`) return path.join(CHARACTER_ROOT, speciesId, 'evolution-stage2.svg');
  if (key === `${speciesId}_stage3`) return path.join(CHARACTER_ROOT, speciesId, 'evolution-stage3.svg');
  if (key === `${speciesId}_base_shiny`) return path.join(CHARACTER_ROOT, speciesId, 'shiny-form.svg');
  return path.join(CHARACTER_ROOT, speciesId, `evolution-${key.slice(speciesId.length + 1)}.svg`);
}

function visibleGroup(xml: string, id: string): boolean {
  const match = new RegExp(`<g\\b[^>]*\\bid="${id}"[^>]*>`).exec(xml);
  return Boolean(match && !/display="none"/.test(match[0]));
}

const ANIMATION_STATES = [
  'idle',
  'blink',
  'happy',
  'sad',
  'angry',
  'curious',
  'thinking',
  'speaking',
  'sleeping',
  'walking',
  'jumping',
  'celebrating',
  'tapped',
  'double-tapped',
  'long-pressed',
  'petting',
  'feeding',
  'playing',
  'working',
  'waiting',
  'concerned',
] as const;

const ALL_MOUTH_IDS = new Set([
  ...Object.values(DEFAULT_EXPRESSIONS.mouths),
  'beak-closed',
  'beak-open',
]);

describe.each(rigs)('$displayName asset pack', (rig: CharacterRig) => {
  const species = getSpecies(rig.speciesId)!;
  const formKeys = species.forms.map((form) => form.id);

  it('ships a file for every registered asset', () => {
    for (const key of Object.keys(rig.assets)) {
      const file = assetFileForForm(rig.speciesId, key);
      expect(fs.existsSync(file), `${rig.speciesId}: ${file}`).toBe(true);
      const xml = fs.readFileSync(file, 'utf8');
      expect(xml).toContain('<svg');
      expect(xml).toMatch(/viewBox="0 0 (320 320|960 680)"/);
    }
  });

  it('loads and parses every form with the shared layer contract', async () => {
    const keys = Array.from(new Set([...formKeys, 'expressions', 'animations']));
    const sources: Record<string, number> = {};
    const xmlByModule = new Map<number, string>();
    keys.forEach((key, index) => {
      const moduleId = index + 1;
      sources[key] = moduleId;
      xmlByModule.set(moduleId, fs.readFileSync(assetFileForForm(rig.speciesId, key), 'utf8'));
    });
    const loader = createSvgLoader({
      sources,
      baseKey: rig.baseFormId,
      resolveKey: rig.resolveFormKey,
      label: rig.displayName,
    });
    loader.setReader(async (moduleId) => xmlByModule.get(moduleId) ?? '');

    for (const formKey of formKeys) {
      const loaded = await loader.loadFormSvg(formKey);
      expect(loaded.fallback).toBe(false);
      expect(loaded.key).toBe(formKey);

      const parts = parseCharacterSvg(loaded.xml, rig);
      expect(parts.body).toContain('body-group');
      expect(parts.head).toContain('head-group');
      expect(parts.head).toContain('eyes-open');
      expect(parts.head).toContain('eyes-closed');
      expect(parts.head).toContain('eyes-thinking');
      expect(parts.accessory).toContain('accessory-group');
      for (const appendage of rig.appendages) {
        expect(parts.appendages[appendage.id], `${rig.speciesId} ${formKey} ${appendage.id}`).toContain(appendage.id);
      }
    }
  });

  it('falls back to the base artwork when a form asset cannot be read', async () => {
    const baseFile = assetFileForForm(rig.speciesId, rig.baseFormId);
    const formKey = formKeys.find((key) => key !== rig.baseFormId)!;
    const loader = createSvgLoader({
      sources: { [rig.baseFormId]: 1, [formKey]: 2 },
      baseKey: rig.baseFormId,
      resolveKey: rig.resolveFormKey,
      label: rig.displayName,
    });
    loader.setReader(async (moduleId) => {
      if (moduleId === 2) throw new Error('asset missing');
      return fs.readFileSync(baseFile, 'utf8');
    });
    const loaded = await loader.loadFormSvg(formKey);
    expect(loaded.fallback).toBe(true);
    expect(loaded.key).toBe(rig.baseFormId);
    expect(loaded.xml).toContain('<svg');
  });

  it('toggles exactly one eye and mouth expression for every state', () => {
    const xml = fs.readFileSync(assetFileForForm(rig.speciesId, rig.baseFormId), 'utf8');
    const head = parseCharacterSvg(xml, rig).head;
    const mouthIds = new Set([...ALL_MOUTH_IDS, ...Object.values(rig.expressions.mouths)]);

    for (const state of ANIMATION_STATES) {
      const output = applyExpression(head, { state, mapping: rig.expressions });
      const visibleEyes = [rig.expressions.eyes.open, rig.expressions.eyes.closed, rig.expressions.eyes.thinking].filter(
        (id) => visibleGroup(output, id)
      );
      const visibleMouths = Array.from(mouthIds).filter((id) => visibleGroup(output, id));
      expect(visibleEyes, `${rig.speciesId} ${state} eyes`).toHaveLength(1);
      expect(visibleMouths, `${rig.speciesId} ${state} mouth`).toHaveLength(1);
    }
  });

  it('shows character-specific flourishes only in the matching state', () => {
    const xml = fs.readFileSync(assetFileForForm(rig.speciesId, rig.baseFormId), 'utf8');
    const head = parseCharacterSvg(xml, rig).head;
    const happy = applyExpression(head, { state: 'happy', mapping: rig.expressions });
    expect(visibleGroup(happy, rig.expressions.blush)).toBe(true);
    expect(visibleGroup(happy, rig.expressions.sweat)).toBe(false);

    const sad = applyExpression(head, { state: 'sad', mapping: rig.expressions });
    expect(visibleGroup(sad, rig.expressions.sweat)).toBe(true);

    const celebrating = applyExpression(head, { state: 'celebrating', mapping: rig.expressions });
    expect(visibleGroup(celebrating, rig.expressions.sparkle)).toBe(true);

    const idle = applyExpression(head, { state: 'idle', mapping: rig.expressions });
    expect(visibleGroup(idle, rig.expressions.blush)).toBe(false);
    expect(visibleGroup(idle, rig.expressions.sparkle)).toBe(false);
  });
});
