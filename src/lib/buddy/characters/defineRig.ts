import { getPersonality } from '../personality';
import {
  DEFAULT_EXPRESSIONS,
  DEFAULT_INTERACTIONS,
  type CharacterRig,
  type ExpressionMapping,
  type InteractionMapping,
} from './core/types';

type CharacterRigInput = Omit<CharacterRig, 'personality' | 'expressions' | 'interactions'> & {
  personality?: CharacterRig['personality'];
  expressions?: Partial<ExpressionMapping> & { mouths?: Record<string, string> };
  interactions?: Partial<InteractionMapping>;
};

/**
 * Every Buddy registers through this factory so the shared renderer always
 * receives a complete personality, expression map and interaction map.
 * Character-specific overrides are explicit; everything else is inherited from
 * the asset layer contract.
 */
export function defineCharacterRig(input: CharacterRigInput): CharacterRig {
  return {
    ...input,
    resolveFormKey:
      input.resolveFormKey ?? ((formId?: string) => (formId && formId in input.assets ? formId : input.baseFormId)),
    personality: input.personality ?? getPersonality(input.speciesId),
    expressions: {
      ...DEFAULT_EXPRESSIONS,
      ...input.expressions,
      eyes: { ...DEFAULT_EXPRESSIONS.eyes, ...input.expressions?.eyes },
      mouths: { ...DEFAULT_EXPRESSIONS.mouths, ...input.expressions?.mouths },
    },
    interactions: { ...DEFAULT_INTERACTIONS, ...input.interactions },
  };
}
