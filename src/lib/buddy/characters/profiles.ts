/**
 * Identity/progression profiles for all 16 Buddy characters.
 *
 * These are derived from the canonical species/personality registries. They do
 * not alter existing rigs, forms, or Kiko's bespoke renderer.
 */

import { getPersonality } from '../personality';
import type { BuddyEventType } from '../events';
import type { BuddyAnimationState, BuddyGroup } from '../types';
import { SPECIES } from '../species';

export interface BuddyAttributeProfile {
  intelligence: number;
  curiosity: number;
  patience: number;
  creativity: number;
  wisdom: number;
  playfulness: number;
  empathy: number;
}

export interface BuddyCharacterProfile {
  characterId: string;
  speciesId: string;
  name: string;
  mbti: string;
  personalityGroup: BuddyGroup;
  species: string;
  description: string;
  communicationStyle: string;
  expressionMap: Record<BuddyAnimationState, string>;
  animationMap: Record<BuddyEventType, BuddyAnimationState>;
  reactionTemplates: Record<BuddyEventType, string[]>;
  attributes: BuddyAttributeProfile;
  assetProfile: {
    renderer: 'rig' | 'kiko';
    baseFormId: string;
    formKeyResolver: string;
  };
}

const ANIMATION_STATES: BuddyAnimationState[] = [
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
];

function buildExpressionMap(): Record<BuddyAnimationState, string> {
  const map = {} as Record<BuddyAnimationState, string>;
  for (const state of ANIMATION_STATES) map[state] = state;
  return map;
}

const BASE_ANIMATION: Record<BuddyEventType, BuddyAnimationState> = {
  task_created: 'curious',
  task_started: 'working',
  task_progress: 'working',
  tool_started: 'working',
  tool_completed: 'happy',
  approval_required: 'waiting',
  task_waiting: 'waiting',
  task_completed: 'celebrating',
  task_failed: 'concerned',
  agent_idle: 'idle',
  user_interaction: 'happy',
};

const GROUP_ANIMATION: Record<BuddyGroup, Partial<Record<BuddyEventType, BuddyAnimationState>>> = {
  NT: { task_created: 'thinking', task_progress: 'thinking', tool_completed: 'happy' },
  NF: { task_created: 'curious', tool_completed: 'celebrating', task_failed: 'sad' },
  SJ: { task_created: 'thinking', task_waiting: 'waiting', tool_completed: 'happy' },
  SP: { task_created: 'jumping', task_progress: 'playing', user_interaction: 'celebrating' },
};

type TemplateMap = Record<BuddyEventType, string[]>;

const GROUP_TEMPLATES: Record<BuddyGroup, TemplateMap> = {
  NT: {
    task_created: ['New objective logged. I have a few angles already.', 'A fresh plan — let us find the cleanest route.'],
    task_started: ['Running the plan now. I will flag anything material.', 'Engaged. Watch the sequence with me.'],
    task_progress: ['Step advanced. Still tracking the larger structure.', 'Progress recorded. No surprises so far.'],
    tool_started: ['Checking one capability now.', 'Running a targeted verification.'],
    tool_completed: ['Check complete. Result is consistent with the plan.', 'That step resolved cleanly. Next variable, please.'],
    approval_required: ['This step needs your explicit approval. I will wait.', 'A sensitive action surfaced. Your call before anything proceeds.'],
    task_waiting: ['Paused at a decision point. Standing by.', 'Holding position until the next instruction.'],
    task_completed: ['Task complete. The approach held up.', 'Done — efficient and verified.'],
    task_failed: ['That route failed. The failure is useful data.', 'Setback noted. We can revise the plan.'],
    agent_idle: ['All quiet. I am ready when you are.', 'No active thread. My attention is yours.'],
    user_interaction: ['Noted. What is the next objective?', 'I am with you. Shall we continue?'],
  },
  NF: {
    task_created: ['A new path is opening up. I am curious already.', 'Something new to work through together.'],
    task_started: ['I am here with you as this begins.', 'Starting now — one gentle step at a time.'],
    task_progress: ['You are moving forward. I can see it.', 'Good progress. Keep going at your pace.'],
    tool_started: ['I am checking this carefully for you.', 'Let me look at that piece with care.'],
    tool_completed: ['That went well. I am glad it worked out.', 'Done kindly and cleanly. Well done.'],
    approval_required: ['This needs your permission before it continues. I will wait with you.', 'A choice is yours to make. Nothing moves until you decide.'],
    task_waiting: ['Waiting here for your signal.', 'Taking a breath with you before the next move.'],
    task_completed: ['You did it. I am so proud of this progress.', 'Complete — and you carried it beautifully.'],
    task_failed: ['That was hard. It is okay; we can try again.', 'A setback, not a verdict. I am still here.'],
    agent_idle: ['Things are calm now. I am still beside you.', 'Quiet moment. I am ready whenever you are.'],
    user_interaction: ['I am glad you are here.', 'That means a lot. What would feel good next?'],
  },
  SJ: {
    task_created: ['A new task is recorded. Let us build it properly.', 'New work queued. I will keep the steps orderly.'],
    task_started: ['Starting with the first dependable step.', 'Underway. I will keep everything accounted for.'],
    task_progress: ['Step complete. The structure is holding.', 'Progress is steady. Continuing in sequence.'],
    tool_started: ['Running the appropriate check.', 'Verifying this part before we move on.'],
    tool_completed: ['Checked and settled. That piece is reliable now.', 'Complete. I made sure the basics were covered.'],
    approval_required: ['This action requires your approval. I will not proceed alone.', 'A permission decision is needed before this step continues.'],
    task_waiting: ['Waiting for the next authorized instruction.', 'Holding steady until you decide.'],
    task_completed: ['Task finished and accounted for. Good work.', 'All steps complete. Nicely handled.'],
    task_failed: ['That did not complete cleanly. We can correct it.', 'A step failed. Let us restore order and try again.'],
    agent_idle: ['Everything is settled. Ready for the next item.', 'No active work. I am standing by.'],
    user_interaction: ['Thank you. What should we do next?', 'Acknowledged. I am ready to help.'],
  },
  SP: {
    task_created: ['Ooh, something new! Let us see what it can do.', 'New mission unlocked. I am in.'],
    task_started: ['Moving! Let us keep this quick and clean.', 'Go time. I am right beside you.'],
    task_progress: ['Nice, another step down. Keep the momentum!', 'Zooming along. This is going well.'],
    tool_started: ['Popping open one tool. Stay sharp.', 'Quick check incoming!'],
    tool_completed: ['Boom — that one worked.', 'Nice hit. That step is done.'],
    approval_required: ['Whoa, this one needs your okay. I will wait.', 'Sensitive move — your call before I do anything.'],
    task_waiting: ['Holding tight. Your move!', 'Waiting on you. I am ready to dash.'],
    task_completed: ['Yes! Task complete. That was smooth.', 'Nailed it. Let us celebrate for a second.'],
    task_failed: ['Oops. That one missed. Shake it off — go again?', 'Wipeout. We can retry, no problem.'],
    agent_idle: ['All quiet. I am ready for the next fun thing.', 'Nothing happening. Bored fox energy.'],
    user_interaction: ['Hey! Good to see you.', 'Nice! What are we doing next?'],
  },
};

const SPECIES_TEMPLATE_OVERRIDES: Partial<Record<string, Partial<TemplateMap>>> = {
  fox: {
    task_created: ['New adventure spotted. Tell me everything!', 'Kiko senses a fresh idea. I like it already.'],
    tool_completed: ['Clever little check. That worked!', 'Sly and effective. I approve.'],
    task_failed: ['Well, that was a tumble. We got this.', 'Even clever foxes slip. Try again with me?'],
  },
  raven: {
    agent_idle: ['Silence is useful. I am thinking.', 'No active plan. I am watching the horizon.'],
  },
  owl: {
    task_progress: ['One more piece of the pattern is clear.', 'The reasoning is holding together.'],
  },
  cheetah: {
    task_progress: ['Faster now. Keep up!', 'Another step gone. Next!'],
  },
  parrot: {
    user_interaction: ['Hello hello! I saw that!', 'Woo! More time with you!'],
  },
};

function buildAnimationMap(group: BuddyGroup, speciesId: string): Record<BuddyEventType, BuddyAnimationState> {
  const map = { ...BASE_ANIMATION, ...GROUP_ANIMATION[group] };
  if (speciesId === 'fox') map.user_interaction = 'celebrating';
  if (speciesId === 'deer' || speciesId === 'panda') map.task_failed = 'sad';
  return map;
}

function clampScore(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value / 10)));
}

function buildAttributes(speciesId: string): BuddyAttributeProfile {
  const p = getPersonality(speciesId);
  return {
    intelligence: clampScore(p.intelligence),
    curiosity: clampScore(p.curiosity),
    patience: clampScore((p.emotionalSensitivity + p.confidence) / 2),
    creativity: clampScore((p.curiosity + p.playfulness) / 2),
    wisdom: clampScore((p.intelligence + p.emotionalSensitivity) / 2),
    playfulness: clampScore(p.playfulness),
    empathy: clampScore(p.emotionalSensitivity),
  };
}

function buildProfile(speciesId: string): BuddyCharacterProfile {
  const species = SPECIES.find((entry) => entry.id === speciesId);
  if (!species) throw new Error(`Unknown Buddy species: ${speciesId}`);
  const personality = getPersonality(speciesId);
  return {
    characterId: species.id,
    speciesId: species.id,
    name: species.name,
    mbti: species.mbti,
    personalityGroup: species.group,
    species: species.name,
    description: species.description,
    communicationStyle: personality.conversationStyle,
    expressionMap: buildExpressionMap(),
    animationMap: buildAnimationMap(species.group, species.id),
    reactionTemplates: {
      ...GROUP_TEMPLATES[species.group],
      ...(SPECIES_TEMPLATE_OVERRIDES[speciesId] ?? {}),
    },
    attributes: buildAttributes(speciesId),
    assetProfile: {
      renderer: species.id === 'fox' ? 'kiko' : 'rig',
      baseFormId: species.forms.find((form) => form.isDefault)?.id ?? `${species.id}_base`,
      formKeyResolver: species.id === 'fox' ? 'kiko' : 'shared-rig',
    },
  };
}

export const BUDDY_CHARACTER_PROFILES: BuddyCharacterProfile[] = SPECIES.map((species) =>
  buildProfile(species.id)
);

const profileById = new Map(BUDDY_CHARACTER_PROFILES.map((profile) => [profile.characterId, profile]));

export function getBuddyCharacterProfile(speciesId: string): BuddyCharacterProfile {
  return profileById.get(speciesId) ?? profileById.get('fox') ?? BUDDY_CHARACTER_PROFILES[0]!;
}

export const ALL_CHARACTER_IDS = BUDDY_CHARACTER_PROFILES.map((profile) => profile.characterId);
