import { getPersonality } from './personality';
import type { BuddyForm, BuddyGroup, BuddySpecies } from './types';

function withPersonality(s: Omit<BuddySpecies, 'personality'>): BuddySpecies {
  return { ...s, personality: getPersonality(s.id) };
}

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
    evolvesTo: ['fox_aether', 'fox_flareonix', 'fox_stormlynx'],
    imageKey: 'fox_vulpixie',
  },
  {
    id: 'fox_aether',
    speciesId: 'fox',
    name: 'Aether Fox',
    stage: 3,
    rarity: 'advanced',
    element: 'spirit',
    description: 'A mystical spirit fox. Calm, wise, and deeply bonded to its human.',
    stats: { power: 72, intelligence: 88, speed: 82, affinity: 85 },
    requirements: { level: 16, bond: 70 },
    evolvesFrom: 'fox_vulpixie',
    evolvesTo: ['fox_sylvia', 'fox_eclipseon'],
    imageKey: 'fox_aether',
  },
  {
    id: 'fox_flareonix',
    speciesId: 'fox',
    name: 'Flareonix',
    stage: 3,
    rarity: 'advanced',
    element: 'fire',
    description: 'A fierce fire-branch evolution. Passionate and protective.',
    stats: { power: 92, intelligence: 70, speed: 85, affinity: 72 },
    requirements: { level: 16, bond: 65, items: [{ itemId: 'fire_core', quantity: 1 }] },
    evolvesFrom: 'fox_vulpixie',
    evolvesTo: ['fox_sylvia', 'fox_eclipseon'],
    imageKey: 'fox_flareonix',
  },
  {
    id: 'fox_stormlynx',
    speciesId: 'fox',
    name: 'Stormlynx',
    stage: 3,
    rarity: 'advanced',
    element: 'electric',
    description: 'An electric-branch evolution. Lightning-fast reflexes and sharp wit.',
    stats: { power: 80, intelligence: 78, speed: 98, affinity: 68 },
    requirements: { level: 16, bond: 65, items: [{ itemId: 'storm_core', quantity: 1 }] },
    evolvesFrom: 'fox_vulpixie',
    evolvesTo: ['fox_sylvia', 'fox_eclipseon'],
    imageKey: 'fox_stormlynx',
  },
  {
    id: 'fox_sylvia',
    speciesId: 'fox',
    name: 'Sylvia',
    stage: 4,
    rarity: 'mythical',
    element: 'light',
    description: 'A sylph-like mythical form. Ethereal, gentle, and luminous.',
    stats: { power: 88, intelligence: 98, speed: 92, affinity: 99 },
    requirements: { level: 30, bond: 95, items: [{ itemId: 'mythic_shard', quantity: 1 }] },
    evolvesFrom: 'fox_aether',
    imageKey: 'fox_sylvia',
  },
  {
    id: 'fox_eclipseon',
    speciesId: 'fox',
    name: 'Eclipseon',
    stage: 4,
    rarity: 'mythical',
    element: 'dark',
    description: 'A dark mythical form born of eclipse. Powerful, mysterious, loyal.',
    stats: { power: 99, intelligence: 90, speed: 94, affinity: 92 },
    requirements: { level: 30, bond: 95, items: [{ itemId: 'shadow_core', quantity: 1 }] },
    evolvesFrom: 'fox_aether',
    imageKey: 'fox_eclipseon',
  },
  {
    id: 'fox_base_shiny',
    speciesId: 'fox',
    name: 'Kiko ✦',
    stage: 1,
    rarity: 'shiny',
    element: 'spirit',
    description: 'A rare shimmering Kiko. Same heart, extraordinary glow.',
    stats: { power: 46, intelligence: 58, speed: 64, affinity: 55 },
    evolvesFrom: 'fox_base',
    imageKey: 'fox_base_shiny',
  },
];

function makeBasicForms(speciesId: string, baseName: string, stage2: string, stage3: string, element: BuddyForm['element'], alt?: { id: string; name: string; element: BuddyForm['element'] }): BuddyForm[] {
  const forms: BuddyForm[] = [
    { id: `${speciesId}_base`, speciesId, name: baseName, stage: 1, rarity: 'common', element, description: `${baseName} is ready to grow with you.`, stats: { power: 40, intelligence: 50, speed: 45, affinity: 50 }, imageKey: `${speciesId}_base`, isDefault: true, evolvesTo: [`${speciesId}_stage2`] },
    { id: `${speciesId}_stage2`, speciesId, name: stage2, stage: 2, rarity: 'advanced', element, description: `${stage2} has grown stronger through your bond.`, stats: { power: 58, intelligence: 62, speed: 58, affinity: 65 }, requirements: { level: 10, bond: 45 }, evolvesFrom: `${speciesId}_base`, evolvesTo: [`${speciesId}_stage3`, ...(alt ? [`${speciesId}_${alt.id}`] : [])], imageKey: `${speciesId}_stage2` },
    { id: `${speciesId}_stage3`, speciesId, name: stage3, stage: 3, rarity: 'advanced', element, description: `${stage3} is a fully evolved companion.`, stats: { power: 75, intelligence: 78, speed: 72, affinity: 82 }, requirements: { level: 20, bond: 75 }, evolvesFrom: `${speciesId}_stage2`, imageKey: `${speciesId}_stage3` },
    { id: `${speciesId}_base_shiny`, speciesId, name: `${baseName} ✦`, stage: 1, rarity: 'shiny', element, description: `A rare shimmering ${baseName}.`, stats: { power: 44, intelligence: 54, speed: 49, affinity: 55 }, evolvesFrom: `${speciesId}_base`, imageKey: `${speciesId}_base_shiny` },
  ];
  if (alt) {
    forms.push({ id: `${speciesId}_${alt.id}`, speciesId, name: alt.name, stage: 3, rarity: 'mythical', element: alt.element, description: `${alt.name} is a rare special evolution.`, stats: { power: 84, intelligence: 84, speed: 80, affinity: 90 }, requirements: { level: 22, bond: 80, items: [{ itemId: `${alt.id}_core`, quantity: 1 }] }, evolvesFrom: `${speciesId}_stage2`, imageKey: `${speciesId}_${alt.id}` });
  }
  return forms;
}

export const SPECIES: BuddySpecies[] = [
  withPersonality({ id: 'raven', name: 'Raven', mbti: 'INTJ', group: 'NT', element: 'dark', description: 'Strategic, observant, and quietly brilliant.', forms: makeBasicForms('raven', 'Raven', 'Nightwing', 'Astral Raven', 'dark', { id: 'shadow', name: 'Umbraven', element: 'dark' }) }),
  withPersonality({ id: 'owl', name: 'Owl', mbti: 'INTP', group: 'NT', element: 'psychic', description: 'Thoughtful, curious, and loves deep questions.', forms: makeBasicForms('owl', 'Owl', 'Scholar Owl', 'Oracle Owl', 'psychic', { id: 'lunar', name: 'Moon Oracle', element: 'light' }) }),
  withPersonality({ id: 'bear', name: 'Bear', mbti: 'ENTJ', group: 'NT', element: 'metal', description: 'Strong leader with steady confidence.', forms: makeBasicForms('bear', 'Bear', 'Guardian Bear', 'Titan Bear', 'metal', { id: 'iron', name: 'Ironclad', element: 'metal' }) }),
  withPersonality({ id: 'fox', name: 'Fox', mbti: 'ENTP', group: 'NT', element: 'spirit', description: 'Clever, playful, and always exploring ideas.', forms: foxForms }),
  withPersonality({ id: 'wolf', name: 'Wolf', mbti: 'INFJ', group: 'NF', element: 'spirit', description: 'Insightful, loyal, and deeply empathetic.', forms: makeBasicForms('wolf', 'Wolf', 'Spirit Wolf', 'Lunar Wolf', 'spirit', { id: 'moon', name: 'Moonhowl', element: 'light' }) }),
  withPersonality({ id: 'deer', name: 'Deer', mbti: 'INFP', group: 'NF', element: 'nature', description: 'Gentle, imaginative, and kind-hearted.', forms: makeBasicForms('deer', 'Deer', 'Grove Deer', 'Sylvan Deer', 'nature', { id: 'bloom', name: 'Bloomhart', element: 'nature' }) }),
  withPersonality({ id: 'labrador', name: 'Labrador', mbti: 'ENFJ', group: 'NF', element: 'light', description: 'Warm, supportive, and naturally encouraging.', forms: makeBasicForms('labrador', 'Labrador', 'Guide Lab', 'Beacon Lab', 'light', { id: 'sun', name: 'Sunpaw', element: 'light' }) }),
  withPersonality({ id: 'dolphin', name: 'Dolphin', mbti: 'ENFP', group: 'NF', element: 'water', description: 'Energetic, creative, and full of joy.', forms: makeBasicForms('dolphin', 'Dolphin', 'Wave Dolphin', 'Nova Dolphin', 'water', { id: 'coral', name: 'Coralwave', element: 'water' }) }),
  withPersonality({ id: 'beaver', name: 'Beaver', mbti: 'ISTJ', group: 'SJ', element: 'nature', description: 'Reliable, practical, and loves building systems.', forms: makeBasicForms('beaver', 'Beaver', 'Builder Beaver', 'Forge Beaver', 'nature', { id: 'oak', name: 'Oakshield', element: 'nature' }) }),
  withPersonality({ id: 'elephant', name: 'Elephant', mbti: 'ISFJ', group: 'SJ', element: 'nature', description: 'Caring, steady, and remembers what matters.', forms: makeBasicForms('elephant', 'Elephant', 'Guardian Elephant', 'Sage Elephant', 'nature', { id: 'lotus', name: 'Lotusguard', element: 'light' }) }),
  withPersonality({ id: 'lion', name: 'Lion', mbti: 'ESTJ', group: 'SJ', element: 'fire', description: 'Bold, organized, and ready to lead.', forms: makeBasicForms('lion', 'Lion', 'Captain Lion', 'Regal Lion', 'fire', { id: 'solar', name: 'Solar Mane', element: 'fire' }) }),
  withPersonality({ id: 'golden-retriever', name: 'Golden Retriever', mbti: 'ESFJ', group: 'SJ', element: 'light', description: 'Friendly, social, and always uplifting.', forms: makeBasicForms('golden-retriever', 'Golden Retriever', 'Loyal Golden', 'Radiant Golden', 'light', { id: 'heart', name: 'Heartgold', element: 'light' }) }),
  withPersonality({ id: 'cat', name: 'Cat', mbti: 'ISTP', group: 'SP', element: 'dark', description: 'Independent, clever, and quietly observant.', forms: makeBasicForms('cat', 'Cat', 'Shadow Cat', 'Phantom Cat', 'dark', { id: 'neon', name: 'Nightprowler', element: 'dark' }) }),
  withPersonality({ id: 'panda', name: 'Panda', mbti: 'ISFP', group: 'SP', element: 'nature', description: 'Calm, creative, and gentle in spirit.', forms: makeBasicForms('panda', 'Panda', 'Harmony Panda', 'Zen Panda', 'nature', { id: 'mist', name: 'Mistbloom', element: 'water' }) }),
  withPersonality({ id: 'cheetah', name: 'Cheetah', mbti: 'ESTP', group: 'SP', element: 'electric', description: 'Fast, bold, and action-oriented.', forms: makeBasicForms('cheetah', 'Cheetah', 'Dash Cheetah', 'Volt Cheetah', 'electric', { id: 'bolt', name: 'Boltstrike', element: 'electric' }) }),
  withPersonality({ id: 'parrot', name: 'Parrot', mbti: 'ESFP', group: 'SP', element: 'air', description: 'Expressive, social, and full of personality.', forms: makeBasicForms('parrot', 'Parrot', 'Chatter Parrot', 'Carnival Parrot', 'air', { id: 'aurora', name: 'Aurorawing', element: 'light' }) }),
];

const speciesById = new Map(SPECIES.map((s) => [s.id, s]));
const formById = new Map<string, BuddyForm>();
for (const s of SPECIES) for (const f of s.forms) formById.set(f.id, f);

export function getSpecies(id: string): BuddySpecies | undefined { return speciesById.get(id); }
export function getForm(id: string): BuddyForm | undefined { return formById.get(id); }
export function getDefaultForm(speciesId: string): BuddyForm | undefined { return getSpecies(speciesId)?.forms.find((f) => f.isDefault); }
export function getAllSpecies(): BuddySpecies[] { return SPECIES; }
export function getSpeciesByGroup(group: BuddyGroup): BuddySpecies[] { return SPECIES.filter((s) => s.group === group); }
export function getFormLine(speciesId: string): BuddyForm[] { return [...(getSpecies(speciesId)?.forms ?? [])].sort((a, b) => a.stage - b.stage); }
export function getEvolutionBranches(formId: string): BuddyForm[] { const form = getForm(formId); if (!form?.evolvesTo?.length) return []; return form.evolvesTo.map(getForm).filter((f): f is BuddyForm => Boolean(f)); }
export function canEvolveTo(userBuddy: { level: number; bond: number; unlockedForms: string[] }, target: BuddyForm, inventory: { itemId: string; quantity: number }[]): { ok: boolean; missing: string[] } { const req = target.requirements; const missing: string[] = []; if (!req) return { ok: true, missing }; if (req.level && userBuddy.level < req.level) missing.push(`Level ${req.level} required`); if (req.bond && userBuddy.bond < req.bond) missing.push(`Bond ${req.bond}% required`); if (req.items) for (const it of req.items) { const have = inventory.find((i) => i.itemId === it.itemId)?.quantity ?? 0; if (have < it.quantity) missing.push(`${it.itemId} x${it.quantity}`); } return { ok: missing.length === 0, missing }; }

export const ALL_SPECIES_IDS = SPECIES.map((s) => s.id);
export function getDefaultActiveSpecies(): string { return 'fox'; }
