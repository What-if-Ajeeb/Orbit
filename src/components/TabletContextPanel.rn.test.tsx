/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { TabletContextPanel } from './TabletContextPanel';

jest.setTimeout(30000);

const mockNavigate = jest.fn();
const mockSetContextPanelOpen = jest.fn();
const mockSetContextPanelWidth = jest.fn();
const mockDb = {};

const mockTasks = [
  {
    id: 7,
    title: 'Pay rent',
    dueAt: null,
    status: 'open',
  },
];
const mockListTasks = jest.fn(async () => mockTasks);
const mockCompleteTask = jest.fn(async () => undefined);
const mockPending = [{ id: 1 }, { id: 2 }];

jest.mock('@expo/vector-icons/Ionicons', () => {
  const ReactModule = require('react');

  return {
    __esModule: true,
    default: () => ReactModule.createElement(require('react-native').View, null, null),
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
    accent: '#f80',
    accentSoft: '#421',
    onInverse: '#000',
  };

  return {
    useAppTheme: () => ({ colors }),
    useStyles: (factory: (theme: { colors: typeof colors }) => unknown) => factory({ colors }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-router', () => ({
  router: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
  },
  usePathname: () => '/chat',
}));

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => mockDb,
}));

jest.mock('@/context/auth', () => ({
  useSession: () => ({ user: { id: 1, name: 'Tester' } }),
}));

jest.mock('@/context/tablet-layout', () => ({
  useTabletLayout: () => ({
    contextPanelWidth: 320,
    setContextPanelWidth: mockSetContextPanelWidth,
    setContextPanelOpen: mockSetContextPanelOpen,
  }),
}));

jest.mock('@/lib/tasks', () => ({
  listTasks: (...args: unknown[]) => mockListTasks(...args),
  completeTask: (...args: unknown[]) => mockCompleteTask(...args),
}));

jest.mock('@/lib/permissions', () => ({
  permissionManager: {
    subscribe: () => jest.fn(),
    getPendingForUser: () => mockPending,
  },
}));

describe('TabletContextPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows route context, history actions, approvals, and open tasks', async () => {
    const view = await render(<TabletContextPanel />);

    await waitFor(() => expect(view.getByText('Pay rent')).toBeTruthy());

    expect(view.getByText('Context')).toBeTruthy();
    expect(view.getByText('Chat')).toBeTruthy();
    expect(view.getByLabelText('Chat history')).toBeTruthy();
    expect(view.getByLabelText('Approvals')).toBeTruthy();
    expect(view.getByText('2')).toBeTruthy();
    expect(view.getByLabelText('Resize context panel')).toBeTruthy();
  });

  it('navigates to chat history', async () => {
    const view = await render(<TabletContextPanel />);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Chat history'));
    });

    expect(mockNavigate).toHaveBeenCalledWith('/conversations');
  });

  it('completes a task from the panel', async () => {
    const view = await render(<TabletContextPanel />);

    await waitFor(() => expect(view.getByLabelText('Complete Pay rent')).toBeTruthy());

    await act(async () => {
      fireEvent.press(view.getByLabelText('Complete Pay rent'));
    });

    await waitFor(() => expect(mockCompleteTask).toHaveBeenCalledWith(mockDb, 1, 7));
    expect(mockListTasks).toHaveBeenCalledTimes(2);
  });

  it('collapses the panel', async () => {
    const view = await render(<TabletContextPanel />);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Collapse context panel'));
    });

    expect(mockSetContextPanelOpen).toHaveBeenCalledWith(false);
  });
});
