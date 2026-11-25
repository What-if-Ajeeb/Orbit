/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { AgentChatView } from './AgentChatView';

jest.setTimeout(30000);

const mockStoredMessages: Record<string, unknown>[] = [];

const mockStore = {
  listConversations: jest.fn(async () => []),
  createConversation: jest.fn(async () => ({
    id: 1,
    userId: 1,
    title: 'New chat',
    agentId: 'research',
    messageCount: 0,
    createdAt: 1,
    updatedAt: 1,
  })),
  listMessages: jest.fn(async () => []),
  addMessage: jest.fn(async () => ({})),
  deleteConversation: jest.fn(async () => undefined),
};

const mockAgent = {
  runAgent: jest.fn(async () => ({
    reply: 'Done',
    traces: [],
    artifacts: [],
    toolEvents: [],
    mode: 'ai' as const,
  })),
};

const mockAttachments = {
  pickImages: jest.fn(async () => [
    {
      id: 'att_1',
      name: 'photo.jpg',
      kind: 'image' as const,
      mimeType: 'image/jpeg',
      uri: 'file:///photo.jpg',
      size: 10,
      data: 'abc123',
    },
  ]),
  pickDocuments: jest.fn(async () => []),
};

jest.mock('@expo/vector-icons/Ionicons', () => {
  const ReactModule = require('react');

  return {
    __esModule: true,
    default: () => ReactModule.createElement(require('react-native').View, null, null),
    glyphMap: {},
  };
});

jest.mock('@/context/theme', () => {
  const colors = {
    background: '#000',
    surface: '#111',
    surfaceAlt: '#222',
    border: '#333',
    text: '#fff',
    textMuted: '#aaa',
    textFaint: '#777',
    accent: '#f00',
    accentSoft: '#400',
    danger: '#f00',
    dangerSoft: '#400',
    success: '#0f0',
    successSoft: '#040',
    warning: '#fa0',
    warningSoft: '#440',
    inverse: '#fff',
    onInverse: '#000',
  };

  const glass = { border: '#333', fill: '#111' };

  return {
    useAppTheme: () => ({ colors, glass, isLight: false }),
    useStyles: (factory: (theme: { colors: typeof colors; glass: typeof glass }) => unknown) =>
      factory({ colors, glass }),
  };
});

jest.mock('@/context/auth', () => ({
  useSession: () => ({ user: { id: 1, name: 'Tester' } }),
}));

jest.mock('@/context/sidebar', () => ({
  useSidebar: () => ({ open: jest.fn() }),
}));

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => ({}),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), navigate: jest.fn() }),
  useFocusEffect: (callback: () => unknown) => {
    require('react').useEffect(callback, []);
  },
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/chat', () => ({
  getChatStore: () => mockStore,
}));

jest.mock('@/lib/ai/settings', () => ({
  loadAiSettings: async () => ({ provider: 'ollama', model: 'local', mode: 'local' }),
  isAiConfigured: () => true,
}));

jest.mock('@/lib/ai/agent', () => ({
  runAgent: (...args: unknown[]) => mockAgent.runAgent(...args),
}));

jest.mock('@/lib/permissions', () => ({
  permissionManager: {
    getActivity: jest.fn(async () => []),
    getState: jest.fn(() => ({ stoppedAgents: [] })),
    subscribe: jest.fn(() => jest.fn()),
    stopAgent: jest.fn(async () => ({
      stopRequested: [],
      uncancellable: [],
      revokedGrants: 0,
      cancelledRequests: 0,
    })),
    resumeAgent: jest.fn(async () => ({ ok: true })),
  },
}));

jest.mock('@/lib/chat-attachments', () => ({
  pickImages: () => mockAttachments.pickImages(),
  pickDocuments: () => mockAttachments.pickDocuments(),
  toChatAttachments: (items: Record<string, unknown>[]) =>
    items.map(({ data: _data, ...meta }) => meta),
  toLlmAttachments: (items: Record<string, unknown>[]) =>
    items.map((item) => ({
      name: item.name as string,
      kind: item.kind as 'image' | 'document',
      mimeType: item.mimeType as string,
      data: item.data as string,
    })),
}));

jest.mock('@/components/ChatBubble', () => ({
  ChatBubble: ({ message }: { message: { content: string } }) =>
    require('react').createElement(
      require('react-native').Text,
      null,
      message.content
    ),
}));

jest.mock('@/components/ChatHistoryPanel', () => ({
  ChatHistoryPanel: () => null,
}));

const AGENT = {
  id: 'research',
  name: 'Research Agent',
  role: 'specialist' as const,
  description: 'Finds and summarizes information.',
  icon: 'search',
};

describe('AgentChatView', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoredMessages.length = 0;
    mockStore.listConversations.mockResolvedValue([]);
    mockStore.listMessages.mockImplementation(async () => mockStoredMessages.slice());
    mockStore.addMessage.mockImplementation(
      async (
        _userId: number,
        _conversationId: number,
        role: string,
        content: string,
        traces: unknown[] = [],
        artifacts: unknown[] = [],
        meta: Record<string, unknown> = {}
      ) => {
        mockStoredMessages.push({
          id: mockStoredMessages.length + 1,
          role,
          content,
          traces,
          artifacts,
          createdAt: 1,
          ...meta,
        });
        return {};
      }
    );
    mockAgent.runAgent.mockResolvedValue({
      reply: 'Done',
      traces: [],
      artifacts: [],
      toolEvents: [],
      mode: 'ai',
    });
  });

  it('shows an agent-specific empty state and keeps send disabled', async () => {
    const view = await render(<AgentChatView agent={AGENT} />);

    await waitFor(() => expect(view.getByText('Chat with Research Agent')).toBeTruthy());
    expect(view.getByLabelText('Send message')).toBeDisabled();
  });

  it('streams text and persists the assistant reply with the agent id', async () => {
    mockAgent.runAgent.mockImplementation(async (input: any) => {
      input.onTextDelta('Hel');
      input.onTextDelta('lo');
      return { reply: 'Hello', traces: [], artifacts: [], toolEvents: [], mode: 'ai' };
    });

    const view = await render(<AgentChatView agent={AGENT} />);

    await waitFor(() => expect(view.getByLabelText('Message Research Agent')).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(view.getByLabelText('Message Research Agent'), 'Summarize this');
    });
    await waitFor(() =>
      expect(view.getByLabelText('Send message').props.accessibilityState.disabled).toBe(false)
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText('Send message'));
    });

    await waitFor(() => expect(mockAgent.runAgent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(view.getByText('Hello')).toBeTruthy());

    expect(mockStore.addMessage).toHaveBeenCalledWith(
      1,
      1,
      'assistant',
      'Hello',
      [],
      [],
      expect.objectContaining({ agentId: 'research' })
    );
  });

  it('offers retry after a failed turn and reuses the original prompt', async () => {
    mockAgent.runAgent
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({
        reply: 'Recovered',
        traces: [],
        artifacts: [],
        toolEvents: [],
        mode: 'ai',
      });

    const view = await render(<AgentChatView agent={AGENT} />);

    await waitFor(() => expect(view.getByLabelText('Message Research Agent')).toBeTruthy());
    await act(async () => {
      fireEvent.changeText(view.getByLabelText('Message Research Agent'), 'Try again');
    });
    await waitFor(() =>
      expect(view.getByLabelText('Send message').props.accessibilityState.disabled).toBe(false)
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText('Send message'));
    });

    await waitFor(() => expect(view.getByText('Retry when back online')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByText('Retry when back online'));
    });

    await waitFor(() => expect(mockAgent.runAgent).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.getByText('Recovered')).toBeTruthy());
  });

  it('turns a picked image into an attachment sent with the next turn', async () => {
    const view = await render(<AgentChatView agent={AGENT} />);

    await waitFor(() => expect(view.getByLabelText('Attach an image')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByLabelText('Attach an image'));
    });

    await waitFor(() => expect(view.getByText('photo.jpg')).toBeTruthy());
    await waitFor(() =>
      expect(view.getByLabelText('Send message').props.accessibilityState.disabled).toBe(false)
    );
    await act(async () => {
      fireEvent.press(view.getByLabelText('Send message'));
    });

    await waitFor(() => expect(mockAgent.runAgent).toHaveBeenCalledTimes(1));

    const input = mockAgent.runAgent.mock.calls[0][0] as {
      history: { attachments?: { data: string }[] }[];
    };
    expect(input.history[input.history.length - 1]?.attachments?.[0]?.data).toBe('abc123');
  });
});
