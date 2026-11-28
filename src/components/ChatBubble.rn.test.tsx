/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { render } from '@testing-library/react-native';

import type { AgentTask } from '@/lib/agent-runtime/types';
import type { ChatMessage } from '@/lib/chat';

jest.setTimeout(30_000);

const mockActionIds: string[] = [];
const mockReportProps: Record<string, unknown>[] = [];
const mockResearchProps: Record<string, unknown>[] = [];
const mockResultProps: Record<string, unknown>[] = [];

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
    background: '#fff',
    surface: '#fff',
    surfaceAlt: '#f5f0ea',
    border: '#e6ded4',
    text: '#241f1b',
    textMuted: '#6f675f',
    textFaint: '#a49a90',
    accent: '#c65f2e',
    accentSoft: '#f8ece5',
    success: '#2f7a4f',
    successSoft: '#e9f4ed',
    warning: '#a86a16',
    warningSoft: '#fbf1dd',
    blue: '#3567a8',
    inverse: '#241f1b',
    onInverse: '#fff',
  };

  return {
    useAppTheme: () => ({ colors, isLight: true }),
    useStyles: (factory: (theme: { colors: typeof colors }) => unknown) => factory({ colors }),
  };
});

jest.mock('@/context/auth', () => ({
  useSession: () => ({ user: { id: 1 } }),
}));

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => ({}),
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/components/actions/AgentActionCard', () => ({
  AgentActionCard: ({ actionId }: { actionId: string }) => {
    mockActionIds.push(actionId);

    return null;
  },
}));

jest.mock('@/components/ToolStatusList', () => ({ ToolStatusList: () => null }));

jest.mock('@/components/tasks/TaskOutputCards', () => {
  const ReactModule = require('react');
  const { Text } = require('react-native');

  return {
    ReportPreviewCard: (props: { artifact: { title: string } }) => {
      mockReportProps.push(props);

      return ReactModule.createElement(Text, null, `Report ${props.artifact.title}`);
    },
    ResearchSummaryCard: (props: { traces: string[] }) => {
      mockResearchProps.push(props);

      return ReactModule.createElement(Text, null, 'Research summary');
    },
    TaskResultCard: (props: { task: { title: string } }) => {
      mockResultProps.push(props);

      return ReactModule.createElement(Text, null, `Task result ${props.task.title}`);
    },
  };
});

const { ChatBubble } = require('./ChatBubble') as typeof import('./ChatBubble');

const task = {
  id: 'task-1',
  title: 'Draft Q3 report',
  status: 'needs_review',
} as AgentTask;

function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 1,
    role: 'assistant',
    content: 'Report ready',
    traces: ['Checked sources'],
    artifacts: [{ id: 'artifact-1', title: 'Q3 report', type: 'markdown', version: 2 }],
    createdAt: 1,
    ...overrides,
  };
}

describe('ChatBubble structured output', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActionIds.length = 0;
    mockReportProps.length = 0;
    mockResearchProps.length = 0;
    mockResultProps.length = 0;
  });

  it('keeps user messages on the right', async () => {
    const user = await render(<ChatBubble message={message({ role: 'user' })} />);
    const userWrap = user.getByText('Report ready').parent?.parent;

    expect(userWrap?.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ alignSelf: 'flex-end' })])
    );
  });

  it('keeps agent messages on the left', async () => {
    const agent = await render(<ChatBubble message={message()} />);
    const agentWrap = agent.getByText('Report ready').parent?.parent;

    expect(agentWrap?.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ alignSelf: 'flex-start' })])
    );
  });

  it('renders report, research and task result cards on task detail', async () => {
    const { getByText } = await render(<ChatBubble message={message()} structured task={task} />);

    expect(getByText('Report Q3 report')).toBeTruthy();
    expect(getByText('Research summary')).toBeTruthy();
    expect(getByText('Task result Draft Q3 report')).toBeTruthy();
    expect(mockReportProps[0]?.artifact).toEqual({
      id: 'artifact-1',
      title: 'Q3 report',
      type: 'markdown',
      version: 2,
    });
    expect(mockResearchProps[0]?.traces).toEqual(['Checked sources']);
    expect(mockResultProps[0]?.task).toBe(task);
  });

  it('reuses the exact-payload approval card for proposed actions', async () => {
    const proposed = message({
      toolEvents: [
        {
          id: 'event-1',
          toolName: 'agent_action_propose',
          status: 'success',
          startedAt: 1,
          summary: 'Proposed email',
          detail: JSON.stringify({ ok: true, actionId: 'action_1234567890_AbCd' }),
        },
      ],
    });

    const { getByText } = await render(<ChatBubble message={proposed} structured task={task} />);

    expect(getByText('Approval request — exact payload')).toBeTruthy();
    expect(mockActionIds).toEqual(['action_1234567890_AbCd']);
  });
});
