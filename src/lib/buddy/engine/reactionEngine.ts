/**
 * Deterministic local event → Buddy reaction mapping.
 *
 * No LLM, network call, tool, or permission check happens here.
 */

import type { BuddyAgentEvent } from '../events';
import type { BuddyCharacterProfile } from '../characters/profiles';
import type { RewardReason } from '../reward-policy';
import type { BuddyAnimationState, BuddyMood, UserBuddy } from '../types';
import { isTransient, transientMs } from './stateMachine';

export interface ReactionReward {
  reason: RewardReason;
  sourceKey: string;
}

export interface ReactionDecision {
  eventKey: string;
  eventType: BuddyAgentEvent['type'];
  templateId: string;
  message: string;
  animation: BuddyAnimationState;
  mood: BuddyMood;
  reward?: ReactionReward;
  presentation: 'inline' | 'history_only' | 'suppressed';
  animate: boolean;
  durationMs: number;
}

export interface ReactionOptions {
  now?: number;
  reducedMotion?: boolean;
  appActive?: boolean;
  allowed?: boolean;
}

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function animationAndMood(
  event: BuddyAgentEvent,
  profile: BuddyCharacterProfile
): { animation: BuddyAnimationState; mood: BuddyMood } {
  switch (event.type) {
    case 'task_completed':
      return { animation: profile.animationMap.task_completed, mood: 'happy' };
    case 'tool_completed':
      if (event.outcome === 'denied') return { animation: 'concerned', mood: 'curious' };
      if (event.outcome === 'failure') return { animation: 'concerned', mood: 'sad' };
      return { animation: profile.animationMap.tool_completed, mood: 'happy' };
    case 'task_failed':
      return {
        animation: event.failureKind === 'cancelled' ? 'sleeping' : profile.animationMap.task_failed,
        mood: event.failureKind === 'cancelled' ? 'calm' : 'sad',
      };
    case 'approval_required':
      return { animation: 'waiting', mood: 'curious' };
    case 'task_waiting':
      return { animation: 'waiting', mood: 'focused' };
    case 'agent_idle':
      return { animation: 'idle', mood: 'calm' };
    case 'user_interaction':
      switch (event.interaction) {
        case 'play':
          return { animation: 'playing', mood: 'excited' };
        case 'feed':
          return { animation: 'feeding', mood: 'happy' };
        case 'pet':
          return { animation: 'petting', mood: 'calm' };
        case 'train':
          return { animation: 'thinking', mood: 'focused' };
        case 'buddy_tap':
          return { animation: 'tapped', mood: 'happy' };
        default:
          return { animation: profile.animationMap.user_interaction, mood: 'happy' };
      }
    default:
      return {
        animation: profile.animationMap[event.type],
        mood: event.type === 'task_created' ? 'curious' : 'focused',
      };
  }
}

function rewardForEvent(event: BuddyAgentEvent): ReactionReward | undefined {
  if (event.type === 'task_completed') {
    return {
      reason: event.priorityBucket === 'high' ? 'taskCompleteHighPriority' : 'taskComplete',
      sourceKey: event.taskId,
    };
  }
  if (event.type === 'user_interaction' && event.interaction !== 'chat_message') {
    return { reason: 'dailyInteraction', sourceKey: event.eventKey };
  }
  return undefined;
}

export function resolveReaction(
  event: BuddyAgentEvent,
  profile: BuddyCharacterProfile,
  buddy: UserBuddy,
  options: ReactionOptions = {}
): ReactionDecision {
  const templates = profile.reactionTemplates[event.type] ?? ['...'];
  const index = stableHash(`${buddy.id}:${event.eventKey}`) % templates.length;
  const { animation, mood } = animationAndMood(event, profile);
  const allowed = options.allowed !== false;
  const appActive = options.appActive !== false;
  const presentation = !allowed
    ? 'suppressed'
    : appActive
      ? 'inline'
      : 'history_only';
  const animate = presentation === 'inline' && options.reducedMotion !== true;
  const durationMs = animate && isTransient(animation) ? transientMs(animation) : 0;

  return {
    eventKey: event.eventKey,
    eventType: event.type,
    templateId: `${event.type}:${index}`,
    message: templates[index],
    animation,
    mood,
    ...(rewardForEvent(event) ? { reward: rewardForEvent(event) } : {}),
    presentation,
    animate,
    durationMs,
  };
}
