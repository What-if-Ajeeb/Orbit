/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import type { AgentTask, AgentTaskStatus } from '@/lib/agent-runtime/types';
import { resetTaskWorkspaceState } from '@/lib/task-workspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
jest.setTimeout(30_000);

const mockPush = jest.fn();
const mockListAgentTasks = jest.fn();
const mockListTasks = jest.fn();
const mockCreateTask = jest.fn();
const mockCompleteTask = jest.fn();
const mockReopenTask = jest.fn();
const mockDeleteTask = jest.fn();

function task(id: string, title: string, status: AgentTaskStatus, updatedAt: number): AgentTask {
  return {
    id,
    userId: 1,
    conversationId: 42,
    projectId: '',
    parentTaskId: null,
    subagentId: null,
    kind: 'turn',
    title,
    status,
    phase: 'ai',
    input: {},
    result: null,
    verification: null,
    error: null,
    attempts: 1,
    maxAttempts: 3,
    priority: 0,
    idempotencyKey: null,
    leaseOwner: null,
    leaseUntil: null,
    budget: {},
    grants: [],
    createdAt: 100,
    updatedAt,
    startedAt: null,
    finishedAt: null,
    nextRunAt: null,
  };
}

jest.mock('expo-router', () => {
  const ReactModule = require('react');

  return {
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(callback, []);
    },
    useRouter: () => ({ push: mockPush, back: jest.fn() }),
  };
});

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => ({}),
}));

jest.mock('@expo/vector-icons/Ionicons', () => {
  const ReactModule = require('react');

  return {
    __esModule: true,
    default: Object.assign(() => ReactModule.createElement(require('react-native').View, null, null), {
      glyphMap: {},
    }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

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

jest.mock('@/context/sidebar', () => ({
  useSidebar: () => ({ open: jest.fn() }),
}));

jest.mock('@/context/tablet-layout', () => ({
  useTabletLayout: () => ({ layout: { isTablet: false, width: 390 } }),
}));

jest.mock('@/lib/agent-runtime/task-manager', () => ({
  listAgentTasks: (...args: unknown[]) => mockListAgentTasks(...args),
}));

jest.mock('@/lib/tasks', () => ({
  listTasks: (...args: unknown[]) => mockListTasks(...args),
  createTask: (...args: unknown[]) => mockCreateTask(...args),
  completeTask: (...args: unknown[]) => mockCompleteTask(...args),
  reopenTask: (...args: unknown[]) => mockReopenTask(...args),
  deleteTask: (...args: unknown[]) => mockDeleteTask(...args),
}));

jest.mock('@/lib/dates', () => ({
  parseTaskText: (value: string) => ({ title: value, dueAt: null }),
}));

jest.mock('@/components/Brand', () => ({ Brand: () => null }));
jest.mock('@/components/EmptyState', () => ({ EmptyState: () => null }));
jest.mock('@/components/FormError', () => ({ FormError: () => null }));
jest.mock('@/components/GlassBackdrop', () => ({ GlassBackdrop: () => null }));
jest.mock('@/components/SidebarButton', () => ({ SidebarButton: () => null }));
jest.mock('@/components/Skeleton', () => ({ Skeleton: () => null }));
jest.mock('@/components/TaskItem', () => {
  const ReactModule = require('react');
  const { Text } = require('react-native');

  return {
    TaskItem: ({ task }: { task: { title: string } }) =>
      ReactModule.createElement(Text, null, task.title),
  };
});
jest.mock('@/components/tasks/TaskDetail', () => ({ TaskDetail: () => null }));

const TasksScreen = require('@/app/(app)/(tabs)/tasks').default as () => React.ReactElement;

async function renderScreen() {
  const view = render(<TasksScreen />);

  await waitFor(() => expect(mockListAgentTasks).toHaveBeenCalled());
  await act(async () => {
    await Promise.resolve();
  });

  return view;
}

describe('task workspace screen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetTaskWorkspaceState();
    mockListAgentTasks.mockResolvedValue([
      task('t-review', 'Draft Q3 report', 'needs_review', 400),
      task('t-approval', 'Send invoice', 'awaiting_approval', 300),
      task('t-running', 'Sync notes', 'running', 200),
      task('t-done', 'Old cleanup', 'completed', 100),
    ]);
    mockListTasks.mockResolvedValue([]);
  });

  it('renders tab controls and grouped real agent tasks', async () => {
    const view = await renderScreen();

    expect(view.getByRole('tab', { name: 'Active' }).props.accessibilityState.selected).toBe(true);
    expect(view.getByText('Draft Q3 report')).toBeTruthy();
    expect(view.getByText('Send invoice')).toBeTruthy();
    expect(view.getByText('Sync notes')).toBeTruthy();
    expect(view.getByLabelText('Resolved, 1 task. Expand')).toBeTruthy();
    expect(view.queryByText('Old cleanup')).toBeNull();
  });

  it('collapses and expands resolved tasks with their real count', async () => {
    const view = await renderScreen();

    expect(view.queryByText('Old cleanup')).toBeNull();

    fireEvent.press(view.getByLabelText('Resolved, 1 task. Expand'));
    await waitFor(() => expect(view.getByText('Old cleanup')).toBeTruthy());

    fireEvent.press(view.getByLabelText('Resolved, 1 task. Collapse'));
    await waitFor(() => expect(view.queryByText('Old cleanup')).toBeNull());
  });

  it('opens a dedicated detail route without a floating add button on Active', async () => {
    const view = await renderScreen();

    expect(view.queryByLabelText('Add task')).toBeNull();

    fireEvent.press(view.getByLabelText('Draft Q3 report, Ready for review. Review the result before it is finalized.'));
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/task/[id]',
      params: { id: 't-review' },
    });
  });

  it('uses the existing inline add action on Up next instead of a floating plus', async () => {
    const view = await renderScreen();

    fireEvent.press(view.getByRole('tab', { name: 'Up next' }));

    await waitFor(() => expect(view.getByLabelText('New task')).toBeTruthy());
    expect(view.getByLabelText('Add task')).toBeTruthy();
    expect(view.queryByText('Draft Q3 report')).toBeNull();
  });
});
