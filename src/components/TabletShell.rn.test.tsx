/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { TabletShell } from './TabletShell';

jest.setTimeout(30000);

const mockSetContextPanelOpen = jest.fn();

const mockLayout = {
  persistentSidebar: false,
  contextPanelAvailable: false,
  contextPanelOpen: false,
};

jest.mock('@expo/vector-icons/Ionicons', () => {
  const ReactModule = require('react');

  return {
    __esModule: true,
    default: () => ReactModule.createElement(require('react-native').View, null, null),
  };
});

jest.mock('@/context/theme', () => {
  const colors = { background: '#000', surface: '#111', border: '#333', accent: '#f80', accentSoft: '#421' };

  return {
    useAppTheme: () => ({ colors }),
    useStyles: (factory: (theme: { colors: typeof colors }) => unknown) => factory({ colors }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 24, right: 24 }),
}));

jest.mock('@/context/tablet-layout', () => ({
  useTabletLayout: () => ({
    layout: mockLayout,
    contextPanelOpen: mockLayout.contextPanelOpen,
    setContextPanelOpen: mockSetContextPanelOpen,
  }),
}));

jest.mock('@/components/TabletSidebar', () => {
  const ReactModule = require('react');

  return {
    TabletSidebar: () =>
      ReactModule.createElement(require('react-native').View, { testID: 'tablet-sidebar' }),
  };
});

jest.mock('@/components/TabletContextPanel', () => {
  const ReactModule = require('react');

  return {
    TabletContextPanel: () =>
      ReactModule.createElement(require('react-native').ScrollView, { testID: 'context-panel' }),
  };
});

describe('TabletShell', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockLayout, {
      persistentSidebar: false,
      contextPanelAvailable: false,
      contextPanelOpen: false,
    });
  });

  it('renders only the workspace on phones', async () => {
    const view = await render(
      <TabletShell>
        <View testID="main-workspace" />
      </TabletShell>
    );

    expect(view.getByTestId('main-workspace')).toBeTruthy();
    expect(view.queryByTestId('tablet-sidebar')).toBeNull();
    expect(view.queryByTestId('context-panel')).toBeNull();
  });

  it('renders sidebar, workspace, and independent context panel on large tablets', async () => {
    Object.assign(mockLayout, {
      persistentSidebar: true,
      contextPanelAvailable: true,
      contextPanelOpen: true,
    });

    const view = await render(
      <TabletShell>
        <View testID="main-workspace" />
      </TabletShell>
    );

    expect(view.getByTestId('tablet-sidebar')).toBeTruthy();
    expect(view.getByTestId('main-workspace')).toBeTruthy();
    expect(view.getByTestId('context-panel')).toBeTruthy();
  });

  it('omits the context panel on compact landscape tablets', async () => {
    Object.assign(mockLayout, {
      persistentSidebar: true,
      contextPanelAvailable: false,
      contextPanelOpen: false,
    });

    const view = await render(
      <TabletShell>
        <View testID="main-workspace" />
      </TabletShell>
    );

    expect(view.getByTestId('tablet-sidebar')).toBeTruthy();
    expect(view.queryByTestId('context-panel')).toBeNull();
  });

  it('reopens a collapsed context panel', async () => {
    Object.assign(mockLayout, {
      persistentSidebar: true,
      contextPanelAvailable: true,
      contextPanelOpen: false,
    });

    const view = await render(
      <TabletShell>
        <View testID="main-workspace" />
      </TabletShell>
    );

    await act(async () => {
      fireEvent.press(view.getByLabelText('Open context panel'));
    });

    expect(mockSetContextPanelOpen).toHaveBeenCalledWith(true);
  });
});
