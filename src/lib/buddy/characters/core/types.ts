import type { BuddyAnimationState, PersonalityProfile } from '../../types';

export type AssetReader = (moduleId: number) => Promise<string>;

export type SvgSourceMap = Record<string, number>;

export type CharacterPartId =
  | 'body-group'
  | 'head-group'
  | 'accessory-group'
  | 'tail-group'
  | 'wing-left-group'
  | 'wing-right-group'
  | 'fin-left-group'
  | 'fin-right-group'
  | 'fluke-group'
  | 'trunk-group'
  | 'pack-group';

export type AppendagePivot = { x: number; y: number };

export type AppendageRig = {
  /** SVG group id, e.g. tail-group or wing-left-group. */
  id: CharacterPartId;
  /** Peak rotation in degrees. */
  amplitude: number;
  /** One full swing duration in ms. */
  duration: number;
  /** Render above the body instead of behind it. */
  front?: boolean;
  /** Phase offset in radians so paired wings alternate. */
  phase?: number;
  /** Rotation pivot in the 320x320 design space. Defaults to the body center. */
  pivot?: AppendagePivot;
};

export type ExpressionMapping = {
  eyes: {
    open: string;
    closed: string;
    thinking: string;
  };
  /**
   * State -> SVG group id. Every character ships its own expression groups;
   * characters with beaks can map speaking/happy to a beak layer instead of a
   * mouth layer without changing the renderer.
   */
  mouths: Record<string, string>;
  blush: string;
  sweat: string;
  sparkle: string;
};

export type InteractionMapping = {
  tap: BuddyAnimationState;
  doubleTap: BuddyAnimationState;
  longPress: BuddyAnimationState;
  pet: BuddyAnimationState;
};

export type CharacterMotion = {
  /** Breathing scale range, e.g. 0.025 for 2.5%. */
  breath: number;
  /** Idle body sway in degrees. */
  sway: number;
  /** Upward idle float in px (birds / dolphins). */
  hover: number;
  /** Head tilt in degrees. */
  headTilt: number;
  /** Ear twitch rotation in degrees. */
  earTwitch: number;
  bodyPivot?: AppendagePivot;
  headPivot?: AppendagePivot;
  earPivot?: AppendagePivot;
};

export type CharacterRig = {
  speciesId: string;
  displayName: string;
  /** Canonical personality from src/lib/buddy/personality.ts. */
  personality: PersonalityProfile;
  /** Form id -> SVG module id. Must include base form id. */
  assets: SvgSourceMap;
  baseFormId: string;
  /** Optional form id resolver for shiny/mythical aliases. */
  resolveFormKey?: (formId?: string) => string;
  appendages: AppendageRig[];
  motion: CharacterMotion;
  expressions: ExpressionMapping;
  interactions: InteractionMapping;
  /** Default expression state when the rig receives no explicit state. */
  defaultState?: BuddyAnimationState;
};

export type CharacterSvgParts = {
  defs: string;
  shadow: string;
  body: string;
  head: string;
  ears: string;
  accessory: string;
  appendages: Record<string, string>;
  raw: string;
};

export const DEFAULT_EXPRESSIONS: ExpressionMapping = {
  eyes: {
    open: 'eyes-open',
    closed: 'eyes-closed',
    thinking: 'eyes-thinking',
  },
  mouths: {
    idle: 'mouth-idle',
    walking: 'mouth-idle',
    happy: 'mouth-happy',
    celebrating: 'mouth-happy',
    playing: 'mouth-happy',
    petting: 'mouth-happy',
    feeding: 'mouth-happy',
    tapped: 'mouth-happy',
    'double-tapped': 'mouth-happy',
    'long-pressed': 'mouth-happy',
    jumping: 'mouth-happy',
    sad: 'mouth-sad',
    concerned: 'mouth-sad',
    angry: 'mouth-angry',
    thinking: 'mouth-thinking',
    curious: 'mouth-curious',
    working: 'mouth-thinking',
    waiting: 'mouth-thinking',
    speaking: 'mouth-speaking',
    sleeping: 'mouth-sleep',
    blink: 'mouth-idle',
  },
  blush: 'expression-blush',
  sweat: 'expression-sweat',
  sparkle: 'expression-sparkle',
};

export const DEFAULT_INTERACTIONS: InteractionMapping = {
  tap: 'tapped',
  doubleTap: 'double-tapped',
  longPress: 'long-pressed',
  pet: 'petting',
};
