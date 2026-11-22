import React from 'react';

import { KikoAvatar } from './kiko/KikoAvatar';
import type { BuddyAnimationState } from '@/lib/buddy/types';

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

// Reusable pipeline: register asset-driven character rigs here as they are built.
export function registerCharacterRenderer(speciesId: string, component: CharacterRendererComponent) {
  registry[speciesId] = component;
}

export function getCharacterRenderer(speciesId: string): CharacterRendererComponent | null {
  return registry[speciesId] ?? null;
}

export function renderCharacter(props: CharacterRendererProps) {
  const Comp = getCharacterRenderer(props.speciesId);
  if (!Comp) return null;
  return <Comp {...props} />;
}

export function CharacterRenderer(props: CharacterRendererProps) {
  return renderCharacter(props);
}
