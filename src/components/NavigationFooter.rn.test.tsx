/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { render } from '@testing-library/react-native';

import { NavigationFooterProvider } from '@/context/navigation-footer';

import { NavigationFooter } from './NavigationFooter';

let mockPathname = '/chat';
const mockLayout = { showBottomNav: true, keyboardVisible: false };
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
  usePathname: () => mockPathname,
}));

jest.mock('@/context/bottom-navigation', () => ({
  useBottomNavigation: () => ({ slots: mockSlots }),
}));

jest.mock('@/context/tablet-layout', () => ({
  useTabletLayout: () => ({ layout: mockLayout }),
}));

jest.setTimeout(30000);

function renderFooter() {
  return render(
    <NavigationFooterProvider>
      <NavigationFooter />
    </NavigationFooterProvider>
  );
}

describe('NavigationFooter', () => {
  beforeEach(() => {
    mockPathname = '/chat';
    mockLayout.showBottomNav = true;
    mockLayout.keyboardVisible = false;
    jest.clearAllMocks();
  });

  it('mounts the three-slot footer on a main navigation route', async () => {
    const view = await renderFooter();

    expect(view.getAllByRole('tab')).toHaveLength(3);
    expect(view.getByLabelText('Open Chat').props.accessibilityState.selected).toBe(true);
  });

  it.each([
    '/settings',
    '/settings/navigation',
    '/plugin/plugin-1',
    '/agent-action',
    '/artifact',
    '/projects/project-1',
  ])('stays hidden on the detail route %s', async (pathname) => {
    mockPathname = pathname;

    const view = await renderFooter();

    expect(view.queryAllByRole('tab')).toHaveLength(0);
  });

  it('stays hidden when a tablet uses the persistent sidebar', async () => {
    mockLayout.showBottomNav = false;

    const view = await renderFooter();

    expect(view.queryAllByRole('tab')).toHaveLength(0);
  });

  it('steps aside while the keyboard is open so the composer is unobstructed', async () => {
    mockLayout.keyboardVisible = true;

    const view = await renderFooter();

    expect(view.queryAllByRole('tab')).toHaveLength(0);
  });
});
