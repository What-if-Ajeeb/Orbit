import { createSvgLoader } from './core/loader';
import type { CharacterRig } from './core/types';
import { BUDDY_RIGS } from './roster';

const rigs = new Map<string, CharacterRig>();
const loaders = new Map<string, ReturnType<typeof createSvgLoader>>();

export function registerCharacterRig(rig: CharacterRig): void {
  rigs.set(rig.speciesId, rig);
  loaders.set(
    rig.speciesId,
    createSvgLoader({
      sources: rig.assets,
      baseKey: rig.baseFormId,
      resolveKey: rig.resolveFormKey,
      label: rig.displayName,
    })
  );
}

for (const rig of BUDDY_RIGS) registerCharacterRig(rig);

export function getCharacterRig(speciesId: string): CharacterRig | undefined {
  return rigs.get(speciesId);
}

export function getCharacterLoader(speciesId: string): ReturnType<typeof createSvgLoader> | undefined {
  return loaders.get(speciesId);
}

export function getAllCharacterRigs(): CharacterRig[] {
  return Array.from(rigs.values());
}

export function clearCharacterRigs(): void {
  rigs.clear();
  loaders.clear();
}
