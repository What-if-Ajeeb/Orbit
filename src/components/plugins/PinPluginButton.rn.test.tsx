/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { PinPluginButton } from './PinPluginButton';

const mockPinState = {
  pinned: false,
  togglePin: jest.fn(),
};

jest.mock('@expo/vector-icons/Ionicons', () => {
  const ReactModule = require('react');

  return {
    __esModule: true,
    default: () => ReactModule.createElement(require('react-native').View, null, null),
  };
});

jest.mock('@/context/theme', () => {
  const colors = {
    surfaceAlt: '#222',
    border: '#333',
    textMuted: '#aaa',
    accent: '#f80',
    accentSoft: '#421',
  };

  return {
    useAppTheme: () => ({ colors }),
    useStyles: (factory: (theme: { colors: typeof colors }) => unknown) => factory({ colors }),
  };
});

jest.mock('@/context/pinned-plugins', () => ({
  usePinnedPlugins: () => ({
    pinnedIds: [],
    ready: true,
    isPinned: () => mockPinState.pinned,
    togglePin: (...args: unknown[]) => mockPinState.togglePin(...args),
    setPinned: jest.fn(),
  }),
}));

describe('PinPluginButton', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPinState.pinned = false;
  });

  it('toggles a plugin pin with an accessible label and selected state', async () => {
    const view = await render(<PinPluginButton pluginId="calendar" label="Calendar" />);

    const button = view.getByLabelText('Pin Calendar');
    expect(button.props.accessibilityState.selected).toBe(false);

    await act(async () => {
      fireEvent.press(button);
    });
    expect(mockPinState.togglePin).toHaveBeenCalledWith('calendar');

    mockPinState.pinned = true;
    await act(async () => {
      view.rerender(<PinPluginButton pluginId="calendar" label="Calendar" />);
    });

    expect(view.getByLabelText('Unpin Calendar').props.accessibilityState.selected).toBe(true);
  });
});
