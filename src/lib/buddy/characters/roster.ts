import { BEAR_SVG_SOURCES } from './assets/bear';
import { BEAVER_SVG_SOURCES } from './assets/beaver';
import { CAT_SVG_SOURCES } from './assets/cat';
import { CHEETAH_SVG_SOURCES } from './assets/cheetah';
import { DEER_SVG_SOURCES } from './assets/deer';
import { DOLPHIN_SVG_SOURCES } from './assets/dolphin';
import { ELEPHANT_SVG_SOURCES } from './assets/elephant';
import { GOLDEN_RETRIEVER_SVG_SOURCES } from './assets/golden-retriever';
import { LABRADOR_SVG_SOURCES } from './assets/labrador';
import { LION_SVG_SOURCES } from './assets/lion';
import { OWL_SVG_SOURCES } from './assets/owl';
import { PANDA_SVG_SOURCES } from './assets/panda';
import { PARROT_SVG_SOURCES } from './assets/parrot';
import { RAVEN_SVG_SOURCES } from './assets/raven';
import { WOLF_SVG_SOURCES } from './assets/wolf';
import { defineCharacterRig } from './defineRig';

/**
 * Original asset-driven rigs for the 15 Buddy species beyond Kiko.
 *
 * Every entry uses the same layer contract documented in
 * orbit-buddy/characters/README.md. Kiko keeps its bespoke renderer because it
 * has extra evolution branches; these rigs share RigCharacterAvatar.
 */
export const RAVEN_RIG = defineCharacterRig({
  speciesId: 'raven',
  displayName: 'Raven',
  assets: RAVEN_SVG_SOURCES,
  baseFormId: 'raven_base',
  appendages: [
    { id: 'wing-left-group', amplitude: 7, duration: 980, pivot: { x: 120, y: 182 } },
    { id: 'wing-right-group', amplitude: 7, duration: 980, pivot: { x: 200, y: 182 }, phase: Math.PI },
    { id: 'tail-group', amplitude: 5, duration: 1300, pivot: { x: 160, y: 276 } },
  ],
  motion: { breath: 0.022, sway: 1.1, hover: 2.5, headTilt: 2.5, earTwitch: 5, bodyPivot: { x: 160, y: 282 }, headPivot: { x: 160, y: 172 }, earPivot: { x: 160, y: 92 } },
});

export const OWL_RIG = defineCharacterRig({
  speciesId: 'owl',
  displayName: 'Owl',
  assets: OWL_SVG_SOURCES,
  baseFormId: 'owl_base',
  appendages: [
    { id: 'wing-left-group', amplitude: 5, duration: 1150, pivot: { x: 118, y: 184 } },
    { id: 'wing-right-group', amplitude: 5, duration: 1150, pivot: { x: 202, y: 184 }, phase: Math.PI },
  ],
  motion: { breath: 0.024, sway: 0.8, hover: 2, headTilt: 3.5, earTwitch: 8, bodyPivot: { x: 160, y: 282 }, headPivot: { x: 160, y: 176 }, earPivot: { x: 160, y: 88 } },
});

export const BEAR_RIG = defineCharacterRig({
  speciesId: 'bear',
  displayName: 'Bear',
  assets: BEAR_SVG_SOURCES,
  baseFormId: 'bear_base',
  appendages: [{ id: 'tail-group', amplitude: 8, duration: 1600, pivot: { x: 204, y: 246 } }],
  motion: { breath: 0.03, sway: 1.2, hover: 0, headTilt: 1.5, earTwitch: 6, bodyPivot: { x: 160, y: 284 }, headPivot: { x: 160, y: 176 }, earPivot: { x: 160, y: 76 } },
});

export const WOLF_RIG = defineCharacterRig({
  speciesId: 'wolf',
  displayName: 'Wolf',
  assets: WOLF_SVG_SOURCES,
  baseFormId: 'wolf_base',
  appendages: [{ id: 'tail-group', amplitude: 14, duration: 880, pivot: { x: 204, y: 240 } }],
  motion: { breath: 0.024, sway: 1.1, hover: 0, headTilt: 2.5, earTwitch: 9, bodyPivot: { x: 160, y: 282 }, headPivot: { x: 160, y: 174 }, earPivot: { x: 160, y: 92 } },
});

export const DEER_RIG = defineCharacterRig({
  speciesId: 'deer',
  displayName: 'Deer',
  assets: DEER_SVG_SOURCES,
  baseFormId: 'deer_base',
  appendages: [{ id: 'tail-group', amplitude: 10, duration: 1050, pivot: { x: 122, y: 238 } }],
  motion: { breath: 0.021, sway: 1.3, hover: 0, headTilt: 3, earTwitch: 14, bodyPivot: { x: 160, y: 282 }, headPivot: { x: 160, y: 168 }, earPivot: { x: 160, y: 96 } },
});

export const LABRADOR_RIG = defineCharacterRig({
  speciesId: 'labrador',
  displayName: 'Labrador',
  assets: LABRADOR_SVG_SOURCES,
  baseFormId: 'labrador_base',
  appendages: [{ id: 'tail-group', amplitude: 18, duration: 560, pivot: { x: 204, y: 234 } }],
  motion: { breath: 0.026, sway: 1.2, hover: 0, headTilt: 2, earTwitch: 8, bodyPivot: { x: 160, y: 282 }, headPivot: { x: 160, y: 176 }, earPivot: { x: 160, y: 94 } },
});

export const DOLPHIN_RIG = defineCharacterRig({
  speciesId: 'dolphin',
  displayName: 'Dolphin',
  assets: DOLPHIN_SVG_SOURCES,
  baseFormId: 'dolphin_base',
  appendages: [
    { id: 'fin-left-group', amplitude: 12, duration: 900, pivot: { x: 120, y: 190 } },
    { id: 'fin-right-group', amplitude: 12, duration: 900, pivot: { x: 200, y: 190 }, phase: Math.PI },
    { id: 'fluke-group', amplitude: 14, duration: 780, pivot: { x: 160, y: 262 } },
  ],
  motion: { breath: 0.02, sway: 1.2, hover: 8, headTilt: 2, earTwitch: 0, bodyPivot: { x: 160, y: 270 }, headPivot: { x: 160, y: 168 } },
});

export const BEAVER_RIG = defineCharacterRig({
  speciesId: 'beaver',
  displayName: 'Beaver',
  assets: BEAVER_SVG_SOURCES,
  baseFormId: 'beaver_base',
  appendages: [{ id: 'tail-group', amplitude: 10, duration: 1250, pivot: { x: 204, y: 238 } }],
  motion: { breath: 0.025, sway: 1, hover: 0, headTilt: 2, earTwitch: 6, bodyPivot: { x: 160, y: 282 }, headPivot: { x: 160, y: 176 }, earPivot: { x: 160, y: 92 } },
});

export const ELEPHANT_RIG = defineCharacterRig({
  speciesId: 'elephant',
  displayName: 'Elephant',
  assets: ELEPHANT_SVG_SOURCES,
  baseFormId: 'elephant_base',
  appendages: [
    { id: 'trunk-group', amplitude: 7, duration: 1450, front: true, pivot: { x: 160, y: 166 } },
    { id: 'tail-group', amplitude: 6, duration: 1350, pivot: { x: 108, y: 232 } },
  ],
  motion: { breath: 0.028, sway: 1, hover: 0, headTilt: 1.5, earTwitch: 4, bodyPivot: { x: 160, y: 284 }, headPivot: { x: 160, y: 174 }, earPivot: { x: 160, y: 94 } },
});

export const LION_RIG = defineCharacterRig({
  speciesId: 'lion',
  displayName: 'Lion',
  assets: LION_SVG_SOURCES,
  baseFormId: 'lion_base',
  appendages: [{ id: 'tail-group', amplitude: 12, duration: 900, pivot: { x: 202, y: 238 } }],
  motion: { breath: 0.027, sway: 1.2, hover: 0, headTilt: 2, earTwitch: 6, bodyPivot: { x: 160, y: 284 }, headPivot: { x: 160, y: 176 }, earPivot: { x: 160, y: 84 } },
});

export const GOLDEN_RETRIEVER_RIG = defineCharacterRig({
  speciesId: 'golden-retriever',
  displayName: 'Golden Retriever',
  assets: GOLDEN_RETRIEVER_SVG_SOURCES,
  baseFormId: 'golden-retriever_base',
  appendages: [{ id: 'tail-group', amplitude: 20, duration: 520, pivot: { x: 204, y: 234 } }],
  motion: { breath: 0.027, sway: 1.3, hover: 0, headTilt: 2.5, earTwitch: 8, bodyPivot: { x: 160, y: 282 }, headPivot: { x: 160, y: 176 }, earPivot: { x: 160, y: 94 } },
});

export const CAT_RIG = defineCharacterRig({
  speciesId: 'cat',
  displayName: 'Cat',
  assets: CAT_SVG_SOURCES,
  baseFormId: 'cat_base',
  appendages: [{ id: 'tail-group', amplitude: 16, duration: 720, pivot: { x: 204, y: 240 } }],
  motion: { breath: 0.022, sway: 1.5, hover: 0, headTilt: 3, earTwitch: 9, bodyPivot: { x: 160, y: 282 }, headPivot: { x: 160, y: 172 }, earPivot: { x: 160, y: 94 } },
});

export const PANDA_RIG = defineCharacterRig({
  speciesId: 'panda',
  displayName: 'Panda',
  assets: PANDA_SVG_SOURCES,
  baseFormId: 'panda_base',
  appendages: [{ id: 'tail-group', amplitude: 6, duration: 1700, pivot: { x: 208, y: 250 } }],
  motion: { breath: 0.028, sway: 0.9, hover: 0, headTilt: 1.5, earTwitch: 5, bodyPivot: { x: 160, y: 284 }, headPivot: { x: 160, y: 176 }, earPivot: { x: 160, y: 78 } },
});

export const CHEETAH_RIG = defineCharacterRig({
  speciesId: 'cheetah',
  displayName: 'Cheetah',
  assets: CHEETAH_SVG_SOURCES,
  baseFormId: 'cheetah_base',
  appendages: [{ id: 'tail-group', amplitude: 14, duration: 660, pivot: { x: 204, y: 242 } }],
  motion: { breath: 0.021, sway: 1.6, hover: 0, headTilt: 3, earTwitch: 7, bodyPivot: { x: 160, y: 282 }, headPivot: { x: 160, y: 172 }, earPivot: { x: 160, y: 94 } },
});

export const PARROT_RIG = defineCharacterRig({
  speciesId: 'parrot',
  displayName: 'Parrot',
  assets: PARROT_SVG_SOURCES,
  baseFormId: 'parrot_base',
  appendages: [
    { id: 'wing-left-group', amplitude: 10, duration: 640, pivot: { x: 120, y: 176 } },
    { id: 'wing-right-group', amplitude: 10, duration: 640, pivot: { x: 200, y: 176 }, phase: Math.PI },
    { id: 'tail-group', amplitude: 8, duration: 950, pivot: { x: 160, y: 276 } },
  ],
  motion: { breath: 0.023, sway: 1.2, hover: 5, headTilt: 3, earTwitch: 0, bodyPivot: { x: 160, y: 280 }, headPivot: { x: 160, y: 168 } },
  expressions: {
    mouths: {
      idle: 'beak-closed',
      walking: 'beak-closed',
      blink: 'beak-closed',
      thinking: 'beak-closed',
      curious: 'beak-closed',
      sad: 'beak-closed',
      concerned: 'beak-closed',
      angry: 'beak-closed',
      sleeping: 'beak-closed',
      working: 'beak-closed',
      waiting: 'beak-closed',
      happy: 'beak-open',
      celebrating: 'beak-open',
      playing: 'beak-open',
      petting: 'beak-open',
      feeding: 'beak-open',
      tapped: 'beak-open',
      'double-tapped': 'beak-open',
      'long-pressed': 'beak-open',
      jumping: 'beak-open',
      speaking: 'beak-open',
    },
  },
});

export const BUDDY_RIGS = [
  RAVEN_RIG,
  OWL_RIG,
  BEAR_RIG,
  WOLF_RIG,
  DEER_RIG,
  LABRADOR_RIG,
  DOLPHIN_RIG,
  BEAVER_RIG,
  ELEPHANT_RIG,
  LION_RIG,
  GOLDEN_RETRIEVER_RIG,
  CAT_RIG,
  PANDA_RIG,
  CHEETAH_RIG,
  PARROT_RIG,
];
