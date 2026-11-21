import type { BuddySpecies, BuddyForm } from './types';

/**
 * Static species + form definitions.
 * Matches the design: 16 base buddies, multi-stage + branch evolutions,
 * Common / Advanced / Shiny / Mythical rarities.
 */

const foxForms: BuddyForm[] = [
  {
    id: 'fox_base',
    speciesId: 'fox',
    name: 'Kiko',
    stage: 1,
    rarity: 'common',
    element: 'spirit',
    description: 'A curious and playful fox companion. Always ready for the next adventure.',
    stats: { power: 42, intelligence: 55, speed: 60, affinity: 50 },
    imageKey: 'fox_base',
    isDefault: true,
    evolvesTo: ['fox_vulpixie', 'fox_aether'],
  },
  {
    id: 'fox_vulpixie',
    speciesId: 'fox',
    name: 'Vulpixie',
    stage: 2,
    rarity: 'advanced',
    element: 'spirit',
    description: 'Swift and clever. Masters small illusions and quick thinking.',
    stats: { power: 58, intelligence: 72, speed: 78, affinity: 65 },
    requirements: { level: 8, bond: 40 },
    evolvesFrom: 'fox_base',
    evolvesTo: ['fox_aether'],
    imageKey: 'fox_vulpixie',
  },
  {
    id: 'fox_aether',
    speciesId: 'fox',
    name: 'Aether Fox',
    stage: 3,
    rarity: 'advanced',
    element: 'spirit',
    description: 'Winged spirit fox. High affinity and ethereal presence.',
    stats: { power: 72, intelligence: 88, speed: 92, affinity: 85 },
    requirements: { level: 16, bond: 70 },
    evolvesFrom: 'fox_base',
    imageKey: 'fox_aether',
  },
  {
    id: 'fox_aether_shiny',
    speciesId: 'fox',
    name: 'Shiny Aether Fox',
    stage: 3,
    rarity: 'shiny',
    element: 'spirit',
    description: 'Rare golden-winged variant. Extremely high affinity.',
    stats: { power: 78, intelligence: 94, speed: 96, affinity: 95 },
    requirements: { level: 16, bond: 85, special: 'shiny_chance' },
    evolvesFrom: 'fox_aether',
    imageKey: 'fox_aether_shiny',
  },
];

const ravenForms: BuddyForm[] = [
  {
    id: 'raven_base',
    speciesId: 'raven',
    name: 'Corvin',
    stage: 1,
    rarity: 'common',
    element: 'dark',
    description: 'Observant and witty. Loves collecting shiny ideas.',
    stats: { power: 48, intelligence: 62, speed: 55, affinity: 45 },
    imageKey: 'raven_base',
    isDefault: true,
    evolvesTo: ['raven_nightwing'],
  },
  {
    id: 'raven_nightwing',
    speciesId: 'raven',
    name: 'Nightwing',
    stage: 2,
    rarity: 'advanced',
    element: 'dark',
    description: 'Silent strategist. Excellent at analysis and planning.',
    stats: { power: 65, intelligence: 85, speed: 70, affinity: 60 },
    requirements: { level: 12, bond: 50 },
    evolvesFrom: 'raven_base',
    imageKey: 'raven_nightwing',
  },
];

const owlForms: BuddyForm[] = [
  {
    id: 'owl_base',
    speciesId: 'owl',
    name: 'Athena',
    stage: 1,
    rarity: 'common',
    element: 'psychic',
    description: 'Wise and calm. Prefers deep conversations and knowledge.',
    stats: { power: 40, intelligence: 70, speed: 45, affinity: 55 },
    imageKey: 'owl_base',
    isDefault: true,
    evolvesTo: ['owl_sage'],
  },
  {
    id: 'owl_sage',
    speciesId: 'owl',
    name: 'Sage Owl',
    stage: 2,
    rarity: 'advanced',
    element: 'psychic',
    description: 'Ancient wisdom embodied. Boosts research and insight.',
    stats: { power: 55, intelligence: 95, speed: 50, affinity: 75 },
    requirements: { level: 14, bond: 60 },
    evolvesFrom: 'owl_base',
    imageKey: 'owl_sage',
  },
];

const bearForms: BuddyForm[] = [
  {
    id: 'bear_base',
    speciesId: 'bear',
    name: 'Bruno',
    stage: 1,
    rarity: 'common',
    element: 'normal',
    description: 'Loyal protector. Strong and dependable.',
    stats: { power: 70, intelligence: 40, speed: 35, affinity: 60 },
    imageKey: 'bear_base',
    isDefault: true,
    evolvesTo: ['bear_guardian'],
  },
  {
    id: 'bear_guardian',
    speciesId: 'bear',
    name: 'Guardian Bear',
    stage: 2,
    rarity: 'advanced',
    element: 'normal',
    description: 'Unbreakable resolve. Excellent for long projects.',
    stats: { power: 92, intelligence: 55, speed: 40, affinity: 80 },
    requirements: { level: 15, bond: 65 },
    evolvesFrom: 'bear_base',
    imageKey: 'bear_guardian',
  },
];

// Simplified remaining species (base + one evolution) for Phase 1
function makeSimpleSpecies(
  id: string,
  name: string,
  mbti: string,
  element: BuddyForm['element'],
  description: string,
  baseStats: BuddyForm['stats'],
  evoName: string,
  evoStats: BuddyForm['stats'],
  evoLevel = 12
): BuddySpecies {
  const baseId = `${id}_base`;
  const evoId = `${id}_evo`;
  return {
    id,
    name,
    mbti,
    element,
    description,
    baseFormId: baseId,
    maxStage: 2,
    forms: [
      {
        id: baseId,
        speciesId: id,
        name,
        stage: 1,
        rarity: 'common',
        element,
        description,
        stats: baseStats,
        imageKey: baseId,
        isDefault: true,
        evolvesTo: [evoId],
      },
      {
        id: evoId,
        speciesId: id,
        name: evoName,
        stage: 2,
        rarity: 'advanced',
        element,
        description: `Evolved form of ${name}.`,
        stats: evoStats,
        requirements: { level: evoLevel, bond: 50 },
        evolvesFrom: baseId,
        imageKey: evoId,
      },
    ],
  };
}

export const BUDDY_SPECIES: Record<string, BuddySpecies> = {
  fox: {
    id: 'fox',
    name: 'Kiko',
    mbti: 'ENTP',
    element: 'spirit',
    description: 'Curious explorer and idea generator.',
    baseFormId: 'fox_base',
    maxStage: 3,
    forms: foxForms,
  },
  raven: {
    id: 'raven',
    name: 'Corvin',
    mbti: 'INTJ',
    element: 'dark',
    description: 'Strategic thinker and observer.',
    baseFormId: 'raven_base',
    maxStage: 2,
    forms: ravenForms,
  },
  owl: {
    id: 'owl',
    name: 'Athena',
    mbti: 'INFJ',
    element: 'psychic',
    description: 'Deep thinker and knowledge seeker.',
    baseFormId: 'owl_base',
    maxStage: 2,
    forms: owlForms,
  },
  bear: {
    id: 'bear',
    name: 'Bruno',
    mbti: 'ISFJ',
    element: 'normal',
    description: 'Reliable guardian and steady worker.',
    baseFormId: 'bear_base',
    maxStage: 2,
    forms: bearForms,
  },
  wolf: makeSimpleSpecies(
    'wolf',
    'Lupin',
    'ESTP',
    'nature',
    'Bold and pack-oriented.',
    { power: 65, intelligence: 50, speed: 70, affinity: 48 },
    'Alpha Wolf',
    { power: 88, intelligence: 62, speed: 85, affinity: 70 }
  ),
  deer: makeSimpleSpecies(
    'deer',
    'Lumi',
    'INFP',
    'nature',
    'Gentle and intuitive.',
    { power: 38, intelligence: 60, speed: 68, affinity: 72 },
    'Spirit Stag',
    { power: 55, intelligence: 78, speed: 82, affinity: 90 }
  ),
  labrador: makeSimpleSpecies(
    'labrador',
    'Buddy',
    'ESFJ',
    'normal',
    'Friendly and energetic helper.',
    { power: 55, intelligence: 45, speed: 60, affinity: 80 },
    'Golden Retriever',
    { power: 70, intelligence: 55, speed: 72, affinity: 95 }
  ),
  dolphin: makeSimpleSpecies(
    'dolphin',
    'Aqua',
    'ENFP',
    'water',
    'Playful and highly intelligent.',
    { power: 50, intelligence: 75, speed: 80, affinity: 70 },
    'Tide Singer',
    { power: 65, intelligence: 90, speed: 95, affinity: 88 }
  ),
  beaver: makeSimpleSpecies(
    'beaver',
    'Chip',
    'ISTJ',
    'nature',
    'Hardworking builder.',
    { power: 60, intelligence: 55, speed: 40, affinity: 50 },
    'Master Builder',
    { power: 78, intelligence: 72, speed: 48, affinity: 65 }
  ),
  elephant: makeSimpleSpecies(
    'elephant',
    'Tusker',
    'ISTP',
    'normal',
    'Wise and powerful memory.',
    { power: 80, intelligence: 65, speed: 30, affinity: 55 },
    'Ancient Tusker',
    { power: 98, intelligence: 80, speed: 35, affinity: 70 }
  ),
  lion: makeSimpleSpecies(
    'lion',
    'Rex',
    'ENTJ',
    'fire',
    'Natural leader.',
    { power: 75, intelligence: 60, speed: 55, affinity: 50 },
    'Solar Lion',
    { power: 95, intelligence: 75, speed: 70, affinity: 68 }
  ),
  golden: makeSimpleSpecies(
    'golden',
    'Aura',
    'ENFJ',
    'spirit',
    'Charismatic motivator.',
    { power: 52, intelligence: 68, speed: 58, affinity: 78 },
    'Radiant Aura',
    { power: 70, intelligence: 85, speed: 72, affinity: 95 }
  ),
  cat: makeSimpleSpecies(
    'cat',
    'Mochi',
    'INTP',
    'psychic',
    'Independent and curious.',
    { power: 45, intelligence: 70, speed: 75, affinity: 40 },
    'Shadow Cat',
    { power: 60, intelligence: 88, speed: 92, affinity: 55 }
  ),
  panda: makeSimpleSpecies(
    'panda',
    'Bao',
    'ISFP',
    'nature',
    'Calm and creative.',
    { power: 58, intelligence: 50, speed: 35, affinity: 75 },
    'Zen Panda',
    { power: 72, intelligence: 68, speed: 42, affinity: 92 }
  ),
  cheetah: makeSimpleSpecies(
    'cheetah',
    'Blitz',
    'ESTJ',
    'electric',
    'Speed demon and executor.',
    { power: 60, intelligence: 48, speed: 95, affinity: 42 },
    'Thunder Cheetah',
    { power: 78, intelligence: 60, speed: 110, affinity: 55 }
  ),
  parrot: makeSimpleSpecies(
    'parrot',
    'Echo',
    'ESFP',
    'normal',
    'Social and expressive.',
    { power: 42, intelligence: 55, speed: 70, affinity: 68 },
    'Rainbow Echo',
    { power: 55, intelligence: 70, speed: 85, affinity: 88 }
  ),
};

export const ALL_SPECIES_IDS = Object.keys(BUDDY_SPECIES);

export function getSpecies(id: string): BuddySpecies | undefined {
  return BUDDY_SPECIES[id];
}

export function getForm(formId: string): BuddyForm | undefined {
  for (const species of Object.values(BUDDY_SPECIES)) {
    const form = species.forms.find((f) => f.id === formId);
    if (form) return form;
  }
  return undefined;
}

export function getDefaultActiveSpecies(): string {
  return 'fox'; // Kiko is the default starter
}
