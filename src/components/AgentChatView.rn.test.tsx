/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { AgentChatView } from './AgentChatView';
import { layout } from '@/theme';

jest.setTimeout(30000);

const mockStoredMessages: Record<string, unknown>[] = [];
const mockTabletLayout = {
  layout: {
    isTablet: false,
  },
};

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

const mockRouter = {
  navigate: jest.fn(),
  push: jest.fn(),
};

const mockChatPreferences = {
  setWebSearchPreference: jest.fn(async (_db: unknown, _userId: number, _agentId: string, enabled: boolean) => ({
    provider: 'ollama' as const,
    mode: 'local' as const,
    baseUrl: 'http://127.0.0.1:11434',
    model: 'local-model',
    apiKey: '',
    webSearch: enabled,
  })),
};

const mockProjectScopes = {
  listChatProjectScopes: jest.fn(async () => [
    { id: 'orbit-workspace', label: 'Orbit workspace', source: 'workspace' as const },
    { id: 'workflow-2', label: 'Workflow: Draft', source: 'workflow' as const },
  ]),
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

const mockBottomSheetProps: Record<string, unknown> = {};
const mockChatBubbleProps: Record<string, unknown>[] = [];

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
  pickCamera: jest.fn(async () => []),
  pickDocuments: jest.fn(async () => []),
};

jest.mock('@expo/ui', () => {
  const ReactModule = require('react');
  const { View } = require('react-native');

  return {
    BottomSheet: (props: any) => {
      Object.assign(mockBottomSheetProps, props);

      return props.isPresented
        ? ReactModule.createElement(View, { testID: props.testID }, props.children)
        : null;
    },
    RNHostView: ({ children }: any) => ReactModule.createElement(View, null, children),
  };
});

jest.mock('@/lib/chat-preferences', () => ({
  setWebSearchPreference: (
    ...args: Parameters<typeof mockChatPreferences.setWebSearchPreference>
  ) => mockChatPreferences.setWebSearchPreference(...args),
}));

jest.mock('@/lib/project-scopes', () => ({
  listChatProjectScopes: () => mockProjectScopes.listChatProjectScopes(),
  WORKSPACE_PROJECT_ID: 'orbit-workspace',
  WORKSPACE_PROJECT_LABEL: 'Orbit workspace',
  WORKSPACE_PROJECT_SCOPE: {
    id: 'orbit-workspace',
    label: 'Orbit workspace',
    source: 'workspace',
  },
}));

jest.mock('@/lib/voice-input', () => ({
  useVoiceInput: () => ({
    available: true,
    listening: false,
    error: null,
    start: jest.fn(async () => undefined),
    stop: jest.fn(),
    cancel: jest.fn(),
  }),
}));

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

jest.mock('@/context/tablet-layout', () => ({
  useTabletLayout: () => mockTabletLayout,
}));

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => ({}),
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({}),
  useRouter: () => mockRouter,
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
  MAX_ATTACHMENTS: 4,
  mergeAttachments: (current: Record<string, unknown>[], incoming: Record<string, unknown>[]) =>
    [...current, ...incoming].slice(0, 4),
  pickCamera: () => mockAttachments.pickCamera(),
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
  ChatBubble: (props: { message: { content: string } }) => {
    mockChatBubbleProps.push(props);

    return require('react').createElement(
      require('react-native').Text,
      null,
      props.message.content
    );
  },
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
    mockChatBubbleProps.length = 0;
    for (const key of Object.keys(mockBottomSheetProps)) {
      delete mockBottomSheetProps[key];
    }
    mockProjectScopes.listChatProjectScopes.mockResolvedValue([
      { id: 'orbit-workspace', label: 'Orbit workspace', source: 'workspace' },
      { id: 'workflow-2', label: 'Workflow: Draft', source: 'workflow' },
    ]);
    mockChatPreferences.setWebSearchPreference.mockImplementation(
      async (_db: unknown, _userId: number, _agentId: string, enabled: boolean) => ({
        provider: 'ollama' as const,
        mode: 'local' as const,
        baseUrl: 'http://127.0.0.1:11434',
        model: 'local-model',
        apiKey: '',
        webSearch: enabled,
      })
    );
    mockTabletLayout.layout.isTablet = false;
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
    const view = await render(<AgentChatView agent={AGENT} showAddMenu />);

    await waitFor(() => expect(view.getByLabelText('Add to chat')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByLabelText('Add to chat'));
    });
    await waitFor(() => expect(view.getByLabelText('Photos')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByLabelText('Photos'));
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

  it('sends a prepared message from the hardware keyboard', async () => {
    const view = await render(<AgentChatView agent={AGENT} showAddMenu />);

    await waitFor(() => expect(view.getByLabelText('Message Research Agent')).toBeTruthy());

    await act(async () => {
      fireEvent.changeText(view.getByLabelText('Message Research Agent'), 'Send with keyboard');
    });
    await waitFor(() =>
      expect(view.getByLabelText('Send message').props.accessibilityState.disabled).toBe(false)
    );

    await act(async () => {
      fireEvent(view.getByLabelText('Message Research Agent'), 'submitEditing');
    });

    await waitFor(() => expect(mockAgent.runAgent).toHaveBeenCalledTimes(1));
    expect(view.getByLabelText('Add to chat')).toBeTruthy();
    expect(view.getByLabelText('Voice input')).toBeTruthy();
  });

  it('caps the chat column on tablets while keeping the composer accessible', async () => {
    mockTabletLayout.layout.isTablet = true;

    const view = await render(<AgentChatView agent={AGENT} />);

    await waitFor(() => expect(view.getByLabelText('Message Research Agent')).toBeTruthy());

    const hasWideStyle = (node: unknown): boolean => {
      if (!node || typeof node !== 'object') {
        return false;
      }

      const element = node as {
        props?: { contentContainerStyle?: unknown };
        children?: unknown;
      };
      const value = element.props?.contentContainerStyle;
      const styles = Array.isArray(value) ? value : [value];

      if (
        styles.some(
          (style) =>
            style !== null &&
            typeof style === 'object' &&
            'maxWidth' in style &&
            style.maxWidth === layout.contentMaxWidth
        )
      ) {
        return true;
      }

      return Array.isArray(element.children) && element.children.some(hasWideStyle);
    };

    expect(hasWideStyle(view.toJSON())).toBe(true);
    expect(view.getByLabelText('Open chat history')).toBeTruthy();
  });

  it('opens the add sheet from the composer and closes it with the X control', async () => {
    const view = await render(<AgentChatView agent={AGENT} showAddMenu />);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Add to chat'));
    });

    await waitFor(() => expect(view.getByLabelText('Camera')).toBeTruthy());
    expect(view.getByLabelText('Photos')).toBeTruthy();
    expect(view.getByLabelText('Files')).toBeTruthy();
    expect(view.getByLabelText('Connectors')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByLabelText('Close add to chat'));
    });

    expect(view.queryByLabelText('Camera')).toBeNull();
  });

  it('uses native sheet dismissal for back press, backdrop tap and downward swipe', async () => {
    const view = await render(<AgentChatView agent={AGENT} showAddMenu />);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Add to chat'));
    });

    await waitFor(() => expect(view.getByLabelText('Camera')).toBeTruthy());
    expect(mockBottomSheetProps.shouldDismissOnBackPress).toBe(true);
    expect(mockBottomSheetProps.shouldDismissOnClickOutside).toBe(true);
    expect(mockBottomSheetProps.snapPoints).toEqual(['half', 'full']);
    expect(mockBottomSheetProps.showDragIndicator).toBe(true);

    await act(async () => {
      (mockBottomSheetProps.onDismiss as () => void)();
    });

    expect(view.queryByLabelText('Camera')).toBeNull();
  });

  it('attaches a camera photo from the add sheet', async () => {
    mockAttachments.pickCamera.mockResolvedValueOnce([
      {
        id: 'att_camera',
        name: 'camera.jpg',
        kind: 'image',
        mimeType: 'image/jpeg',
        uri: 'file:///camera.jpg',
        size: 12,
        data: 'camera123',
      },
    ]);

    const view = await render(<AgentChatView agent={AGENT} showAddMenu />);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Add to chat'));
    });
    await waitFor(() => expect(view.getByLabelText('Camera')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByLabelText('Camera'));
    });

    await waitFor(() => expect(view.getByText('camera.jpg')).toBeTruthy());
    expect(mockAttachments.pickCamera).toHaveBeenCalledTimes(1);
    expect(view.queryByLabelText('Camera')).toBeNull();
  });

  it('persists the Web Search toggle through the chat preference helper', async () => {
    const view = await render(<AgentChatView agent={AGENT} showAddMenu />);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Add to chat'));
    });
    await waitFor(() => expect(view.getByLabelText('Web Search')).toBeTruthy());

    expect(view.getByLabelText('Web Search').props.value).toBe(true);

    await act(async () => {
      fireEvent(view.getByLabelText('Web Search'), 'valueChange', false);
    });

    await waitFor(() =>
      expect(mockChatPreferences.setWebSearchPreference).toHaveBeenCalledWith(
        expect.anything(),
        1,
        'research',
        false
      )
    );
    await waitFor(() => expect(view.getByLabelText('Web Search').props.value).toBe(false));
  });

  it('passes a selected project scope into the agent turn', async () => {
    const view = await render(<AgentChatView agent={AGENT} showAddMenu />);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Add to chat'));
    });
    await waitFor(() => expect(view.getByLabelText('Add to project')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByLabelText('Add to project'));
    });
    await waitFor(() => expect(view.getByLabelText('Select Workflow: Draft')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByLabelText('Select Workflow: Draft'));
    });

    await act(async () => {
      fireEvent.press(view.getByLabelText('Close add to chat'));
    });

    await act(async () => {
      fireEvent.changeText(view.getByLabelText('Message Research Agent'), 'Use this workflow');
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText('Send message'));
    });

    await waitFor(() => expect(mockAgent.runAgent).toHaveBeenCalledTimes(1));
    const input = mockAgent.runAgent.mock.calls[0][0] as {
      projectId: string;
      projectLabel: string;
    };
    expect(input.projectId).toBe('workflow-2');
    expect(input.projectLabel).toBe('Workflow: Draft');
  });

  it('opens the existing connectors screen from the sheet', async () => {
    const view = await render(<AgentChatView agent={AGENT} showAddMenu />);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Add to chat'));
    });
    await waitFor(() => expect(view.getByLabelText('Connectors')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByLabelText('Connectors'));
    });

    expect(mockRouter.navigate).toHaveBeenCalledWith('/connections');
  });

  it('locks task detail to its conversation and renders structured output', async () => {
    mockStore.listMessages.mockResolvedValue([
      {
        id: 1,
        role: 'assistant',
        content: 'Report ready',
        traces: ['Checked sources'],
        artifacts: [],
        createdAt: 1,
      },
    ]);

    const task = {
      id: 'task-1',
      status: 'needs_review',
      title: 'Draft Q3 report',
    };

    const view = await render(
      <AgentChatView
        agent={AGENT}
        detail={{
          title: 'Draft Q3 report',
          status: 'Ready for review',
          conversationId: 7,
          task: task as never,
        }}
      />
    );

    await waitFor(() => expect(view.getByText('Draft Q3 report')).toBeTruthy());

    expect(view.getByLabelText('Reply to Orbit...')).toBeTruthy();
    expect(view.getByLabelText('Back to tasks')).toBeTruthy();
    expect(view.getByLabelText('Task options')).toBeTruthy();
    expect(view.queryByLabelText('Message Research Agent')).toBeNull();
    expect(mockStore.listMessages).toHaveBeenCalledWith(1, 7, 200);
    expect(mockChatBubbleProps.length).toBeGreaterThan(0);
    expect(mockChatBubbleProps.every((props) => props.structured === true)).toBe(true);
  });
});
