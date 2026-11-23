import React from 'react';

import { getCharacterRig } from '@/lib/buddy/characters/rigs';
import type { BuddyAnimationState } from '@/lib/buddy/types';

import { RigCharacterAvatar } from './character/RigCharacterAvatar';
import { KikoAvatar } from './kiko/KikoAvatar';

export type CharacterRendererProps = {
  speciesId: string;
  formId?: string;
  size?: number;
  state?: BuddyAnimationState;
  speaking?: boolean;
  onStateChange?: (state: BuddyAnimationState) => void;
  interactive?: boolean;
};

export type CharacterRendererComponent = React.ComponentType<CharacterRendererProps>;

const registry: Record<string, CharacterRendererComponent> = {
  fox: KikoAvatar,
};

/**
 * Special-case renderers live in `registry` (Kiko has bespoke evolution
 * branches). Every other species is resolved from the shared asset-driven rig
 * registry, so no Buddy duplicates the full renderer.
 */
export function getCharacterRenderer(speciesId: string): CharacterRendererComponent | null {
  const registered = registry[speciesId];
  if (registered) return registered;
  return getCharacterRig(speciesId) ? RigCharacterAvatar : null;
}

export function registerCharacterRenderer(speciesId: string, component: CharacterRendererComponent) {
  registry[speciesId] = component;
}

export function renderCharacter(props: CharacterRendererProps) {
  const Comp = getCharacterRenderer(props.speciesId);
  if (!Comp) return null;
  return <Comp {...props} />;
}

export function CharacterRenderer(props: CharacterRendererProps) {
  return renderCharacter(props);
}
