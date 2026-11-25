/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import NavigationSettingsScreen from '@/app/(app)/settings/navigation';

jest.setTimeout(30000);

const mockSetDraftSlot = jest.fn();
const mockMoveDraftSlot = jest.fn();
const mockSaveDraft = jest.fn(async () => undefined);
const mockDiscardDraft = jest.fn();
const mockRestoreDefaults = jest.fn(async () => undefined);
const mockUseBottomNavigation = jest.fn();

const destination = (id: string, label: string) => ({
  id,
  label,
  icon: 'chatbubbles-outline',
  href: `/${id}`,
  description: `${label} destination`,
  source: 'builtin' as const,
});

const slots = [
  { index: 0, requestedId: 'chat', available: true, destination: destination('chat', 'Chat') },
  { index: 1, requestedId: 'tasks', available: true, destination: destination('tasks', 'Tasks') },
  { index: 2, requestedId: 'make', available: true, destination: destination('make', 'Make') },
];

jest.mock('@expo/vector-icons/Ionicons', () => {
  const ReactModule = require('react');
  const Icon = () => ReactModule.createElement(require('react-native').View, null, null);

  return {
    __esModule: true,
    default: Object.assign(Icon, {
      glyphMap: { 'chatbubbles-outline': true, chatbubbles: true },
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

jest.mock('@/context/bottom-navigation', () => ({
  useBottomNavigation: (...args: unknown[]) => mockUseBottomNavigation(...args),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

jest.mock('expo-router', () => ({
  router: { navigate: jest.fn() },
  usePathname: () => '/settings/navigation',
}));

jest.mock('@/components/settings/SettingsScreen', () => {
  const ReactModule = require('react');

  return {
    SettingsScreen: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(require('react-native').View, null, children),
  };
});

jest.mock('@/components/settings/SettingsGroup', () => {
  const ReactModule = require('react');

  return {
    SettingsGroup: ({ children }: { children: React.ReactNode }) =>
      ReactModule.createElement(require('react-native').View, null, children),
  };
});

jest.mock('@/components/settings/SettingsFeedback', () => ({
  SettingsFeedback: () => null,
}));

describe('Navigation settings', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseBottomNavigation.mockReturnValue({
      draftSlots: slots,
      destinations: [
        ...slots.map((slot) => slot.destination),
        { ...destination('buddy', 'Buddy'), source: 'plugin' as const, description: 'Buddy plugin' },
      ],
      hasChanges: true,
      setDraftSlot: mockSetDraftSlot,
      moveDraftSlot: mockMoveDraftSlot,
      saveDraft: mockSaveDraft,
      discardDraft: mockDiscardDraft,
      restoreDefaults: mockRestoreDefaults,
    });
  });

  it('shows three slots and reorders them', async () => {
    const view = await render(<NavigationSettingsScreen />);
    await act(async () => {});

    expect(view.getByLabelText('Change slot 1, currently Chat')).toBeTruthy();
    expect(view.getByLabelText('Change slot 3, currently Make')).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByLabelText('Move slot 2 left'));
    });

    expect(mockMoveDraftSlot).toHaveBeenCalledWith(1, 0);
  });

  it('uses the picker to change a slot', async () => {
    const view = await render(<NavigationSettingsScreen />);
    await act(async () => {});

    await act(async () => {
      fireEvent.press(view.getByLabelText('Change slot 1, currently Chat'));
    });

    await act(async () => {
      fireEvent.press(view.getByLabelText('Use Buddy'));
    });

    expect(mockSetDraftSlot).toHaveBeenCalledWith(0, 'buddy');
  });

  it('saves and restores defaults', async () => {
    const view = await render(<NavigationSettingsScreen />);
    await act(async () => {});

    await act(async () => {
      fireEvent.press(view.getByText('Save'));
    });
    await waitFor(() => expect(mockSaveDraft).toHaveBeenCalledTimes(1));

    await act(async () => {
      fireEvent.press(view.getByText('Restore defaults'));
    });
    await waitFor(() => expect(mockRestoreDefaults).toHaveBeenCalledTimes(1));
  });
});
