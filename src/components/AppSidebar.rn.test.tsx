/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { Alert, Animated } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { AppSidebar, getInitials, SidebarContent } from './AppSidebar';

const mockClose = jest.fn();
const mockOpen = jest.fn();
const mockNavigate = jest.fn();
const mockReplace = jest.fn();
const mockSwitchAccount = jest.fn(async (..._args: unknown[]) => undefined);
const mockDb = {};
let mockSidebarOpen = true;
const mockPinState = {
  groups: [
    { id: 'everything', pluginIds: [] as string[] },
    { id: 'more', pluginIds: [] as string[] },
  ],
  collapsedGroupIds: [] as string[],
};

const mockPinActions = {
  togglePin: jest.fn(),
  setPinned: jest.fn(),
  pinPlugin: jest.fn(),
  unpinPlugin: jest.fn(),
  movePinnedPlugin: jest.fn(),
  movePinnedPluginToGroup: jest.fn(),
  setGroupExpanded: jest.fn(),
  toggleGroup: jest.fn(),
};

const mockPluginSnapshot = {
  navigation: [] as Record<string, unknown>[],
  summaries: [] as Record<string, unknown>[],
};

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
  const Icon = () => ReactModule.createElement(require('react-native').View, null, null);

  return {
    __esModule: true,
    default: Object.assign(Icon, { glyphMap: {} }),
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
  usePluginSnapshot: () => mockPluginSnapshot,
}));

jest.mock('@/context/pinned-plugins', () => ({
  usePinnedPlugins: () => {
    const pinnedIds = mockPinState.groups.flatMap((group) => group.pluginIds);

    return {
      state: { groups: mockPinState.groups, collapsedGroupIds: mockPinState.collapsedGroupIds },
      pinnedIds,
      groups: mockPinState.groups,
      collapsedGroupIds: mockPinState.collapsedGroupIds,
      ready: true,
      isPinned: (id: string) => pinnedIds.includes(id),
      togglePin: (...args: unknown[]) => mockPinActions.togglePin(...args),
      setPinned: (...args: unknown[]) => mockPinActions.setPinned(...args),
      pinPlugin: (...args: unknown[]) => mockPinActions.pinPlugin(...args),
      unpinPlugin: (...args: unknown[]) => mockPinActions.unpinPlugin(...args),
      movePinnedPlugin: (...args: unknown[]) => mockPinActions.movePinnedPlugin(...args),
      movePinnedPluginToGroup: (...args: unknown[]) =>
        mockPinActions.movePinnedPluginToGroup(...args),
      setGroupExpanded: (...args: unknown[]) => mockPinActions.setGroupExpanded(...args),
      toggleGroup: (...args: unknown[]) => mockPinActions.toggleGroup(...args),
    };
  },
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
    mockPinState.groups = [
      { id: 'everything', pluginIds: [] },
      { id: 'more', pluginIds: [] },
    ];
    mockPinState.collapsedGroupIds = [];
    mockPluginSnapshot.navigation = [];
    mockPluginSnapshot.summaries = [];
    mockChatStore.listConversations.mockResolvedValue([mockConversation]);
    jest.spyOn(Animated, 'timing').mockImplementation((value, config) => ({
      start: (callback?: Animated.EndCallback) => {
        value.setValue(config.toValue as number);
        callback?.({ finished: true });
      },
      stop: () => undefined,
      reset: () => undefined,
    }));
  });

  it('builds two-letter avatar initials from full names', () => {
    expect(getInitials('Ada Lovelace')).toBe('AL');
    expect(getInitials('Ada')).toBe('A');
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

  it('keeps secondary and advanced destinations out of the sidebar', async () => {
    const view = await render(<AppSidebar />);
    await act(async () => {});

    expect(view.queryByText('More workspace')).toBeNull();
    expect(view.queryByText('Manage chat history')).toBeNull();
    expect(view.queryByText('Advanced')).toBeNull();
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

  it('truncates recents and opens the selected conversation', async () => {
    mockChatStore.listConversations.mockResolvedValueOnce(
      Array.from({ length: 9 }, (_, index) => ({
        ...mockConversation,
        id: index + 1,
        title: `Recent ${index + 1}`,
      }))
    );

    const view = await render(<AppSidebar />);

    await waitFor(() => {
      expect(view.getAllByLabelText(/^Open chat Recent /)).toHaveLength(6);
    });

    fireEvent.press(view.getByLabelText('Open chat Recent 6'));

    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/chat?c=6'));
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

  it('shows a subtle tree empty state when no plugins are pinned', async () => {
    const view = await render(<AppSidebar />);
    await act(async () => {});

    expect(view.getByText('Pinned')).toBeTruthy();
    expect(view.getByText('No pinned plugins yet.')).toBeTruthy();
    expect(view.getByLabelText('Pin plugin')).toBeTruthy();
  });

  it('opens a pinned plugin from its nested sidebar row', async () => {
    mockPinState.groups[0].pluginIds = ['calendar'];
    mockPluginSnapshot.summaries = [
      {
        manifest: {
          pluginId: 'calendar',
          name: 'Calendar',
          icon: 'calendar-outline',
        },
        status: 'enabled',
        legacy: false,
      },
    ];

    const view = await render(<AppSidebar />);
    await act(async () => {});

    fireEvent.press(view.getByLabelText('Calendar'));

    expect(mockNavigate).toHaveBeenCalledWith('/plugin/calendar');
    expect(mockClose).toHaveBeenCalled();
  });

  it('collapses a pinned group from its chevron', async () => {
    const view = await render(<AppSidebar />);
    await act(async () => {});

    fireEvent.press(view.getByLabelText('Collapse Everything group'));

    expect(mockPinActions.toggleGroup).toHaveBeenCalledWith('everything');
  });

  it('expands a collapsed pinned group from its chevron', async () => {
    mockPinState.collapsedGroupIds = ['everything'];

    const view = await render(<AppSidebar />);
    await act(async () => {});

    fireEvent.press(view.getByLabelText('Expand Everything group'));

    expect(mockPinActions.toggleGroup).toHaveBeenCalledWith('everything');
  });

  it('unpins a plugin from its long-press menu', async () => {
    mockPinState.groups[0].pluginIds = ['calendar'];
    mockPluginSnapshot.summaries = [
      {
        manifest: { pluginId: 'calendar', name: 'Calendar', icon: 'calendar-outline' },
        status: 'enabled',
        legacy: false,
      },
    ];

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((title, message, buttons) => {
      const actions = (buttons ?? []) as { text?: string; onPress?: () => void }[];
      expect(title).toBe('Calendar');
      expect(message).toContain('Reorder');
      actions.find((action) => action.text === 'Unpin')?.onPress?.();
    });

    const view = await render(<AppSidebar />);
    await act(async () => {});

    fireEvent(view.getByLabelText('Calendar'), 'longPress');

    expect(alertSpy).toHaveBeenCalled();
    expect(mockPinActions.unpinPlugin).toHaveBeenCalledWith('calendar');
  });

  it('adds an installed plugin from the Pin plugin picker', async () => {
    mockPluginSnapshot.summaries = [
      {
        manifest: { pluginId: 'calendar', name: 'Calendar', icon: 'calendar-outline' },
        status: 'enabled',
        legacy: false,
      },
    ];

    const view = await render(<AppSidebar />);
    await act(async () => {});

    fireEvent.press(view.getByLabelText('Pin plugin'));

    await waitFor(() => {
      expect(view.getByLabelText('Add Calendar')).toBeTruthy();
    });

    fireEvent.press(view.getByLabelText('Add Calendar'));

    expect(mockPinActions.pinPlugin).toHaveBeenCalledWith('calendar', 'everything');
  });

  it('offers chat history from Recents', async () => {
    const view = await render(<AppSidebar />);
    await act(async () => {});

    fireEvent.press(view.getByLabelText('Open chat history'));

    expect(mockNavigate).toHaveBeenCalledWith('/conversations');
  });

  it('keeps the account footer free of a dropdown arrow', async () => {
    const view = await render(<AppSidebar />);
    await act(async () => {});

    expect(view.getByLabelText('Account settings')).toBeTruthy();
    expect(view.queryByLabelText('Switch account')).toBeNull();
  });

  it('collapses a persistent sidebar to an icon rail without losing labels', async () => {
    const onCollapse = jest.fn();
    const onNavigate = jest.fn();

    const view = await render(
      <SidebarContent
        variant="persistent"
        collapsed
        onCollapse={onCollapse}
        onNavigate={onNavigate}
      />
    );
    await act(async () => {});

    fireEvent.press(view.getByLabelText('Expand sidebar'));
    fireEvent.press(view.getByLabelText('Chats'));

    expect(onCollapse).toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledWith('/chat');
    expect(view.queryByText('Pinned')).toBeNull();
    expect(view.queryByLabelText('Pin plugin')).toBeNull();
  });
});
