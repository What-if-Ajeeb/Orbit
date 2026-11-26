import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';

import { TabletLayoutProvider, useTabletLayout } from './tablet-layout';

jest.setTimeout(30000);

const DEFAULT_PREFS = {
  sidebarCollapsed: null,
  contextPanelOpen: null,
  contextPanelRatio: 0.28,
};

const mockPrefs = { ...DEFAULT_PREFS };

const mockLoadTabletLayoutPrefs = jest.fn(async () => ({ ...mockPrefs }));
const mockSaveTabletLayoutPrefs = jest.fn(async () => undefined);

let mockLayout = {
  mode: 'phone',
  orientation: 'portrait',
  isTablet: false,
  isLandscapeTablet: false,
  persistentSidebar: false,
  showBottomNav: true,
  contextPanelAvailable: false,
  sidebarWidth: 224,
  width: 390,
  height: 844,
  layoutWidth: 390,
  layoutHeight: 844,
  keyboardVisible: false,
};

jest.mock('@/hooks/useResponsiveLayout', () => ({
  useResponsiveLayout: () => mockLayout,
}));

jest.mock('@/lib/tablet-layout-storage', () => ({
  CONTEXT_PANEL_MIN_RATIO: 0.2,
  CONTEXT_PANEL_MAX_RATIO: 0.38,
  DEFAULT_TABLET_LAYOUT_PREFS: DEFAULT_PREFS,
  loadTabletLayoutPrefs: (...args: unknown[]) => mockLoadTabletLayoutPrefs(...args),
  saveTabletLayoutPrefs: (...args: unknown[]) => mockSaveTabletLayoutPrefs(...args),
}));

function Probe() {
  const {
    layout,
    sidebarCollapsed,
    toggleSidebar,
    contextPanelOpen,
    toggleContextPanel,
    contextPanelWidth,
  } = useTabletLayout();

  const directLayout = useResponsiveLayout();

  return (
    <View>
      <Text testID="direct-panel-available">{String(directLayout.contextPanelAvailable)}</Text>
      <Text testID="panel-available">{String(layout.contextPanelAvailable)}</Text>
      <Text testID="sidebar-collapsed">{String(sidebarCollapsed)}</Text>
      <Text testID="context-open">{String(contextPanelOpen)}</Text>
      <Text testID="context-width">{String(contextPanelWidth)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Toggle sidebar" onPress={toggleSidebar} />
      <Pressable accessibilityRole="button" accessibilityLabel="Toggle context" onPress={toggleContextPanel} />
    </View>
  );
}

describe('TabletLayoutProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockPrefs, DEFAULT_PREFS);
    mockLayout = {
      mode: 'phone',
      orientation: 'portrait',
      isTablet: false,
      isLandscapeTablet: false,
      persistentSidebar: false,
      showBottomNav: true,
      contextPanelAvailable: false,
      sidebarWidth: 224,
      width: 390,
      height: 844,
      layoutWidth: 390,
      layoutHeight: 844,
      keyboardVisible: false,
    };
  });

  it('preserves sidebar and panel preferences when rotating into a large tablet', async () => {
    const view = await render(
      <TabletLayoutProvider>
        <Probe />
      </TabletLayoutProvider>
    );

    await waitFor(() => expect(view.getByTestId('sidebar-collapsed').props.children).toBe('false'));
    await act(async () => {});

    await act(async () => {
      fireEvent.press(view.getByLabelText('Toggle sidebar'));
      fireEvent.press(view.getByLabelText('Toggle context'));
    });

    expect(view.getByTestId('sidebar-collapsed').props.children).toBe('true');
    expect(view.getByTestId('context-open').props.children).toBe('false');
    await waitFor(() =>
      expect(mockSaveTabletLayoutPrefs).toHaveBeenLastCalledWith(
        expect.objectContaining({ contextPanelOpen: true })
      )
    );

    mockLayout = {
      ...mockLayout,
      mode: 'tablet-landscape-expanded',
      orientation: 'landscape',
      isTablet: true,
      isLandscapeTablet: true,
      persistentSidebar: true,
      showBottomNav: false,
      contextPanelAvailable: true,
      sidebarWidth: 280,
      width: 1366,
      height: 1024,
      layoutWidth: 1366,
      layoutHeight: 1024,
    };

    await act(async () => {
      view.rerender(
        <TabletLayoutProvider>
          <Probe />
        </TabletLayoutProvider>
      );
    });

    expect(view.getByTestId('direct-panel-available').props.children).toBe('true');
    expect(view.getByTestId('panel-available').props.children).toBe('true');
    expect(view.getByTestId('sidebar-collapsed').props.children).toBe('true');
    expect(view.getByTestId('context-open').props.children).toBe('true');
    expect(view.getByTestId('context-width').props.children).not.toBe('NaN');

    await waitFor(() => expect(mockSaveTabletLayoutPrefs).toHaveBeenCalled());
  });

  it('only shows the context panel when the breakpoint allows it', async () => {
    Object.assign(mockPrefs, { ...DEFAULT_PREFS, contextPanelOpen: false });

    const view = await render(
      <TabletLayoutProvider>
        <Probe />
      </TabletLayoutProvider>
    );

    await waitFor(() => expect(view.getByTestId('context-open').props.children).toBe('false'));

    await act(async () => {
      fireEvent.press(view.getByLabelText('Toggle context'));
    });

    expect(view.getByTestId('context-open').props.children).toBe('false');
  });
});
