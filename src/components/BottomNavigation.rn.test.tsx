/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import {
  BOTTOM_NAV_PILL_HEIGHT,
  BOTTOM_NAV_RESERVE,
  BottomNavigation,
  BottomNavigationBar,
} from './BottomNavigation';

const mockNavigate = jest.fn();
const mockSlots = [
  {
    index: 0,
    requestedId: 'chat',
    available: true,
    destination: {
      id: 'chat',
      label: 'Chat',
      icon: 'chatbubbles-outline',
      href: '/chat',
      description: 'Agent conversations',
      source: 'builtin' as const,
    },
  },
  {
    index: 1,
    requestedId: 'tasks',
    available: true,
    destination: {
      id: 'tasks',
      label: 'Tasks',
      icon: 'checkbox-outline',
      href: '/tasks',
      description: 'Your task list',
      source: 'builtin' as const,
    },
  },
  {
    index: 2,
    requestedId: 'make',
    available: true,
    destination: {
      id: 'make',
      label: 'Make',
      icon: 'flash-outline',
      href: '/workflows',
      description: 'Agent workflows',
      source: 'builtin' as const,
    },
  },
];

jest.mock('@expo/vector-icons/Ionicons', () => {
  const ReactModule = require('react');
  const Icon = () => ReactModule.createElement(require('react-native').View, null, null);

  return {
    __esModule: true,
    default: Object.assign(Icon, {
      glyphMap: {
        'chatbubbles-outline': true,
        chatbubbles: true,
        'checkbox-outline': true,
        checkbox: true,
        'flash-outline': true,
        flash: true,
      },
    }),
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

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-router', () => ({
  router: {
    navigate: (...args: unknown[]) => mockNavigate(...args),
  },
  usePathname: () => '/chat',
}));

jest.mock('@/context/bottom-navigation', () => ({
  useBottomNavigation: () => ({ slots: mockSlots }),
}));

describe('BottomNavigation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders exactly three accessible tabs and marks the current route', async () => {
    const view = await render(
      <BottomNavigationBar slots={mockSlots} activePath="/chat" onSelect={jest.fn()} />
    );

    await act(async () => {});

    expect(view.getAllByRole('tab')).toHaveLength(3);
    expect(view.getByLabelText('Open Chat').props.accessibilityState.selected).toBe(true);
    expect(view.getByLabelText('Open Tasks').props.accessibilityState.selected).toBe(false);
  });

  it('disables presses in preview mode', async () => {
    const onSelect = jest.fn();
    const view = await render(
      <BottomNavigationBar slots={mockSlots} activePath={null} onSelect={onSelect} preview />
    );

    await act(async () => {
      fireEvent.press(view.getByLabelText('Open Chat'));
    });

    expect(onSelect).not.toHaveBeenCalled();
  });

  it('navigates to the selected destination href', async () => {
    const view = await render(<BottomNavigation />);

    await act(async () => {
      fireEvent.press(view.getByLabelText('Open Make'));
    });

    expect(mockNavigate).toHaveBeenCalledWith('/workflows');
  });

  it('renders a floating pill lifted above the bottom safe area', async () => {
    const view = await render(<BottomNavigation />);
    const pill = view.getByTestId('bottom-navigation-pill');

    expect(pill.props.style).toEqual(
      expect.objectContaining({ minHeight: BOTTOM_NAV_PILL_HEIGHT })
    );
    expect(pill.parent?.props.style).toEqual(
      expect.arrayContaining([expect.objectContaining({ bottom: 10 })])
    );
    expect(BOTTOM_NAV_RESERVE).toBeGreaterThan(BOTTOM_NAV_PILL_HEIGHT);
  });
});
