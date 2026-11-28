import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UserBuddy } from '../buddy/types';
import type { AiSettings } from './settings';
import type { LlmMessage, LlmToolDefinition, LlmTurn } from './types';

import { buddyLocalReply, requestBuddyCompletion } from './buddy-chat';

const mocks = vi.hoisted(() => ({
  configured: true,
  requestCompletion: vi.fn(
    async (
      _settings: AiSettings,
      _messages: LlmMessage[],
      _tools: LlmToolDefinition[],
      _options?: { signal?: AbortSignal }
    ): Promise<LlmTurn> => ({ text: 'Hello from Buddy AI.', toolCalls: [] })
  ),
  loadAiSettings: vi.fn(async () => ({}) as AiSettings),
  isAiConfigured: vi.fn(() => true),
}));

vi.mock('./providers', () => ({
  requestCompletion: mocks.requestCompletion,
}));

vi.mock('./settings', () => ({
  loadAiSettings: mocks.loadAiSettings,
  isAiConfigured: mocks.isAiConfigured,
}));

const buddy: UserBuddy = {
  id: 'buddy-1',
  userId: 1,
  speciesId: 'fox',
  nickname: 'Kiko',
  currentFormId: 'fox_base',
  level: 2,
  xp: 100,
  bond: 30,
  isActive: true,
  mood: 'happy',
  unlockedForms: ['fox_base'],
  createdAt: 1,
  updatedAt: 1,
  lastInteractedAt: null,
};

describe('narrow Buddy chat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured = true;
    mocks.isAiConfigured.mockImplementation(() => mocks.configured);
  });

  it('sends only personality facts and the explicit message with no tools', async () => {
    const result = await requestBuddyCompletion({ buddy, message: 'How are you today?' });

    expect(result).toEqual({ text: 'Hello from Buddy AI.', source: 'ai' });
    expect(mocks.requestCompletion).toHaveBeenCalledTimes(1);
    const [settings, messages, tools] = mocks.requestCompletion.mock.calls[0]!;
    expect(settings).toBeDefined();
    expect(tools).toEqual([]);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('system');
    expect(messages[1]).toEqual({ role: 'user', content: 'How are you today?' });

    const system = messages[0]!.content;
    expect(system).toContain('Kiko');
    expect(system).toContain('fox');
    expect(system).not.toContain('project');
    expect(system).not.toContain('memory');
    expect(system).not.toContain('session');
    expect(system).not.toContain('approval ID');
  });

  it('uses a deterministic local reply when no AI provider is configured', async () => {
    mocks.configured = false;

    const first = await requestBuddyCompletion({ buddy, message: 'Hello there' });
    const second = await requestBuddyCompletion({ buddy, message: 'Hello there' });

    expect(first.source).toBe('local');
    expect(second.source).toBe('local');
    expect(first.text).toBe(second.text);
    expect(buddyLocalReply(buddy, 'Hello there')).toBe(first.text);
    expect(mocks.requestCompletion).not.toHaveBeenCalled();
  });

  it('falls back locally if the provider requests tools or fails', async () => {
    mocks.requestCompletion.mockResolvedValueOnce({ text: '', toolCalls: [{ id: '1', name: 'read', arguments: '{}' }] });
    const toolReply = await requestBuddyCompletion({ buddy, message: 'Can you edit a file?' });
    expect(toolReply.source).toBe('local');
    expect(toolReply.text).toBe(buddyLocalReply(buddy, 'Can you edit a file?'));

    mocks.requestCompletion.mockRejectedValueOnce(new Error('offline'));
    const failed = await requestBuddyCompletion({ buddy, message: 'Are you there?' });
    expect(failed.source).toBe('local');
  });
});
