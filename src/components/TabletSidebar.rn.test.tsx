/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { layout, spacing } from '@/theme';

import { TabletSidebar } from './TabletSidebar';

const EXPECTED_RAIL_WIDTH = layout.touchTarget + 8 + spacing.sm * 2;

let mockCollapsed = false;
let mockSidebarWidth = 224;
const mockNavigate = jest.fn();
const mockToggleSidebar = jest.fn();

jest.mock('@expo/vector-icons/Ionicons', () => {
  const ReactModule = require('react');

  return {
    __esModule: true,
    default: () => ReactModule.createElement(require('react-native').View, null, null),
  };
});

jest.mock('@/context/theme', () => {
  const colors = { background: '#000', border: '#333' };

  return {
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
}));

jest.mock('@/context/tablet-layout', () => ({
  useTabletLayout: () => ({
    layout: { sidebarWidth: mockSidebarWidth },
    sidebarCollapsed: mockCollapsed,
    toggleSidebar: mockToggleSidebar,
  }),
}));

jest.mock('@/components/AppSidebar', () => {
  const ReactModule = require('react');
  const { View: MockView } = require('react-native');

  return {
    SidebarContent: ({ collapsed }: { collapsed: boolean }) =>
      ReactModule.createElement(MockView, { testID: 'sidebar-content', collapsed }),
  };
});

describe('TabletSidebar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCollapsed = false;
    mockSidebarWidth = 224;
  });

  function sidebarStyle(view: ReturnType<typeof render>) {
    return StyleSheet.flatten(view.getByTestId('tablet-sidebar').props.style) as {
      width?: number;
      paddingHorizontal?: number;
    };
  }

  it('keeps the full panel width when expanded', async () => {
    mockSidebarWidth = 280;

    const view = await render(<TabletSidebar />);
    const style = sidebarStyle(view);

    expect(style.width).toBe(280);
    expect(style.paddingHorizontal).toBe(spacing.md);
    expect(view.getByTestId('sidebar-content').props.collapsed).toBe(false);
  });

  it('shrinks the container to an icon rail when collapsed', async () => {
    mockCollapsed = true;

    const view = await render(<TabletSidebar />);
    const style = sidebarStyle(view);

    expect(style.width).toBe(EXPECTED_RAIL_WIDTH);
    expect(style.paddingHorizontal).toBe(spacing.sm);
    expect(view.getByTestId('sidebar-content').props.collapsed).toBe(true);
  });
});
