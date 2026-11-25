/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { Animated } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { AppSidebar } from './AppSidebar';

const mockClose = jest.fn();
const mockOpen = jest.fn();
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockSwitchAccount = jest.fn(async (..._args: unknown[]) => undefined);
const mockDb = {};
let mockSidebarOpen = true;

const mockConversation = {
  id: 7,
  userId: 1,
  title: 'Weekly email review',
  agentId: 'master',
  messageCount: 4,
  createdAt: 1,
  updatedAt: 2,
};

const mockChatStore = {
  listConversations: jest.fn(async () => [mockConversation]),
};

jest.mock('@expo/vector-icons/Ionicons', () => {
  const ReactModule = require('react');

  return {
    __esModule: true,
    default: () => ReactModule.createElement(require('react-native').View, null, null),
    glyphMap: {},
  };
});

jest.mock('@/components/Brand', () => {
  const ReactModule = require('react');

  return {
    Brand: () => ReactModule.createElement(require('react-native').View, null, null),
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
    danger: '#f00',
    dangerSoft: '#400',
    success: '#0f0',
    successSoft: '#040',
    warning: '#fa0',
    warningSoft: '#440',
    inverse: '#fff',
    onInverse: '#000',
  };

  return {
    useAppTheme: () => ({ colors, glass: { border: '#333' }, isLight: false }),
    useStyles: (factory: (theme: { colors: typeof colors }) => unknown) => factory({ colors }),
  };
});

jest.mock('@/context/auth', () => ({
  useSession: () => ({
    user: { id: 1, name: 'Ajeeb', email: 'ajeeb@example.com' },
    accounts: [{ id: 1, name: 'Ajeeb', email: 'ajeeb@example.com' }],
    switchAccount: (...args: unknown[]) => mockSwitchAccount(...args),
  }),
}));

jest.mock('@/context/sidebar', () => ({
  useSidebar: () => ({
    isOpen: mockSidebarOpen,
    open: (...args: unknown[]) => mockOpen(...args),
    close: (...args: unknown[]) => mockClose(...args),
  }),
}));

jest.mock('@/context/plugins', () => ({
  usePluginSnapshot: () => ({ navigation: [] }),
}));

jest.mock('expo-sqlite', () => ({
  useSQLiteContext: () => mockDb,
}));

jest.mock('expo-router', () => ({
  router: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
    replace: (...args: unknown[]) => mockReplace(...args),
  },
  usePathname: () => '/settings',
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('@/lib/chat', () => ({
  getChatStore: () => mockChatStore,
}));

// The drawer mounts Animated views and a scroll view; give the renderer enough
// time on cold Jest workers without slowing down the rest of the suite.
jest.setTimeout(30000);

describe('AppSidebar', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockSidebarOpen = true;
    jest.spyOn(Animated, 'timing').mockImplementation((value, config) => ({
      start: (callback?: Animated.EndCallback) => {
        value.setValue(config.toValue as number);
        callback?.({ finished: true });
      },
      stop: () => undefined,
      reset: () => undefined,
    }));
  });

  it('shows the six primary workspace destinations', async () => {
    const view = await render(<AppSidebar />);
    await act(async () => {});

    expect(view.getByText('Chats')).toBeTruthy();
    expect(view.getByText('Projects')).toBeTruthy();
    expect(view.getByText('Plugins')).toBeTruthy();
    expect(view.getByText('Marketplace')).toBeTruthy();
    expect(view.getByText('Buddy')).toBeTruthy();
    expect(view.getByText('Settings')).toBeTruthy();
  });

  it('navigates to the real Projects route and closes the drawer', async () => {
    const view = await render(<AppSidebar />);
    await act(async () => {});

    fireEvent.press(view.getByText('Projects'));

    expect(mockNavigate).toHaveBeenCalledWith('/projects');
    expect(mockClose).toHaveBeenCalled();
  });

  it('opens Settings from the primary navigation', async () => {
    const view = await render(<AppSidebar />);
    await act(async () => {});

    fireEvent.press(view.getByText('Settings'));

    expect(mockNavigate).toHaveBeenCalledWith('/settings');
    expect(mockClose).toHaveBeenCalled();
  });

  it('opens account settings when no other account is available', async () => {
    const view = await render(<AppSidebar />);
    await act(async () => {});

    fireEvent.press(view.getByLabelText('Account settings'));

    expect(mockNavigate).toHaveBeenCalledWith('/settings/account');
    expect(mockClose).toHaveBeenCalled();
  });

  it('opens a readable recent conversation', async () => {
    const view = await render(<AppSidebar />);

    await waitFor(() => {
      expect(view.getByLabelText('Open chat Weekly email review')).toBeTruthy();
    });

    fireEvent.press(view.getByLabelText('Open chat Weekly email review'));

    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/chat?c=7'));
  });

  it('keeps New chat available from the drawer footer', async () => {
    const view = await render(<AppSidebar />);
    await act(async () => {});

    fireEvent.press(view.getByLabelText('Start a new chat'));

    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/chat?n=1'));
  });

  it('collapses from the header button', async () => {
    const view = await render(<AppSidebar />);
    await act(async () => {});

    fireEvent.press(view.getByLabelText('Collapse sidebar'));

    expect(mockClose).toHaveBeenCalled();
  });

  it('exposes an edge swipe zone while collapsed', async () => {
    mockSidebarOpen = false;
    const view = await render(<AppSidebar />);
    await act(async () => {});

    expect(view.getByLabelText('Swipe right to open navigation')).toBeTruthy();
  });
});
