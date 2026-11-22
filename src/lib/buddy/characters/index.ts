import { KIKO_BASE_SVG } from './kiko/base';

export type BuddyCharacterAsset = {
  speciesId: string;
  baseSvg: string;
};

export const BUDDY_CHARACTER_ASSETS: Record<string, BuddyCharacterAsset> = {
  fox: { speciesId: 'fox', baseSvg: KIKO_BASE_SVG },
};

export function getBuddyCharacterAsset(speciesId: string): BuddyCharacterAsset | undefined {
  return BUDDY_CHARACTER_ASSETS[speciesId];
}
