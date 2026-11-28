import { describe, expect, it } from 'vitest';

import { getBuddyCharacterProfile } from '../characters/profiles';
import type { BuddyAgentEvent } from '../events';
import type { UserBuddy } from '../types';
import { resolveReaction } from './reactionEngine';

const buddy: UserBuddy = {
  id: 'buddy-1',
  userId: 1,
  speciesId: 'fox',
  nickname: 'Kiko',
  currentFormId: 'fox_base',
  level: 1,
  xp: 0,
  bond: 0,
  isActive: true,
  mood: 'calm',
  unlockedForms: ['fox_base'],
  createdAt: 1,
  updatedAt: 1,
  lastInteractedAt: null,
};

const profile = getBuddyCharacterProfile('fox');

function taskCompleted(priorityBucket: 'low' | 'normal' | 'high' = 'normal'): BuddyAgentEvent {
  return {
    eventKey: 'task:1:task-1:9:completed',
    userId: 1,
    occurredAt: 100,
    source: 'task',
    type: 'task_completed',
    taskId: 'task-1',
    verified: true,
    priorityBucket,
  };
}

describe('deterministic Buddy reactions', () => {
  it('returns the same message, expression and animation for the same event', () => {
    const first = resolveReaction(taskCompleted(), profile, buddy);
    const second = resolveReaction(taskCompleted(), profile, buddy);
    expect(first).toEqual(second);
    expect(first.animation).toBe('celebrating');
    expect(first.mood).toBe('happy');
    expect(profile.reactionTemplates.task_completed).toContain(first.message);
  });

  it('maps high-priority task completion to the canonical reward', () => {
    const decision = resolveReaction(taskCompleted('high'), profile, buddy);
    expect(decision.reward).toEqual({
      reason: 'taskCompleteHighPriority',
      sourceKey: 'task-1',
    });
  });

  it('does not reward agent chat messages or routine task events', () => {
    const chat = resolveReaction(
      {
        eventKey: 'interaction:1:agent_chat:5',
        userId: 1,
        occurredAt: 100,
        source: 'chat',
        type: 'user_interaction',
        interaction: 'chat_message',
        surface: 'agent_chat',
      },
      profile,
      buddy
    );
    expect(chat.reward).toBeUndefined();

    expect(resolveReaction(
      {
        eventKey: 'task:1:task-1:1:created',
        userId: 1,
        occurredAt: 100,
        source: 'task',
        type: 'task_created',
        taskId: 'task-1',
        kind: 'agent',
        priorityBucket: 'low',
      },
      profile,
      buddy
    ).reward).toBeUndefined();
  });

  it('respects reduced motion, background state and explicit allowlist', () => {
    const event: BuddyAgentEvent = {
      eventKey: 'tool:1:trace:step:ruby.read:completed',
      userId: 1,
      occurredAt: 100,
      source: 'runtime',
      type: 'tool_completed',
      toolName: 'ruby.read',
      outcome: 'success',
      durationBucket: 'fast',
    };

    const animated = resolveReaction(event, profile, buddy, { reducedMotion: false, appActive: true });
    expect(animated.presentation).toBe('inline');
    expect(animated.animate).toBe(true);

    const reduced = resolveReaction(event, profile, buddy, { reducedMotion: true, appActive: true });
    expect(reduced.animate).toBe(false);
    expect(reduced.durationMs).toBe(0);

    const background = resolveReaction(event, profile, buddy, { appActive: false });
    expect(background.presentation).toBe('history_only');
    expect(background.animate).toBe(false);

    const denied = resolveReaction(event, profile, buddy, { allowed: false });
    expect(denied.presentation).toBe('suppressed');
  });

  it('uses character-specific reaction language without exposing task details', () => {
    const decision = resolveReaction(
      {
        eventKey: 'approval:1:trace:step:shell.exec:required',
        userId: 1,
        occurredAt: 100,
        source: 'runtime',
        type: 'approval_required',
        toolName: 'shell.exec',
        reasonCode: 'risk',
      },
      profile,
      buddy
    );
    expect(decision.animation).toBe('waiting');
    expect(profile.reactionTemplates.approval_required).toContain(decision.message);
    expect(decision.message).not.toContain('shell.exec');
  });
});
