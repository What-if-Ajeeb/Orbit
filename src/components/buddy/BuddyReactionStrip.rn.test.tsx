/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

const mockDismiss = jest.fn();
let mockReaction: any = null;

jest.mock('@expo/vector-icons/Ionicons', () => {
  const ReactModule = require('react');
  return {
    __esModule: true,
    default: () => ReactModule.createElement(require('react-native').View, null, null),
    glyphMap: {},
  };
});

jest.mock('@/context/theme', () => {
  const colors = {
    background: '#fff',
    surface: '#fff',
    surfaceAlt: '#f5f0ea',
    border: '#e6ded4',
    text: '#241f1b',
    textMuted: '#6f675f',
    textFaint: '#a49a90',
    accent: '#c65f2e',
    accentSoft: '#f8ece5',
    accentStrong: '#c65f2e',
    success: '#2f7a4f',
    onInverse: '#fff',
  };
  return {
    useAppTheme: () => ({ colors, isLight: true }),
    useStyles: (factory: (theme: { colors: typeof colors }) => unknown) => factory({ colors }),
  };
});

jest.mock('@/context/buddy-reactions', () => ({
  useBuddyReactions: () => ({ reaction: mockReaction, recent: [], dismiss: mockDismiss }),
}));

const { BuddyReactionStrip } = require('./BuddyReactionStrip') as typeof import('./BuddyReactionStrip');

describe('BuddyReactionStrip', () => {
  beforeEach(() => {
    mockDismiss.mockClear();
    mockReaction = {
      eventKey: 'task:1:task-1:9:completed',
      eventType: 'task_completed',
      templateId: 'task_completed:0',
      message: 'Task complete. The approach held up.',
      animation: 'celebrating',
      mood: 'happy',
      presentation: 'inline',
      animate: true,
      durationMs: 0,
    };
  });

  it('renders compact contextual reactions inline', async () => {
    const view = await render(<BuddyReactionStrip />);
    await act(async () => {});
    expect(view.getByTestId('buddy-reaction-strip')).toBeTruthy();
    expect(view.getByText('Task complete. The approach held up.')).toBeTruthy();
    expect(view.getByText('Buddy · task completed')).toBeTruthy();
  });

  it('does not render suppressed or background-only reactions', async () => {
    mockReaction.presentation = 'suppressed';
    const suppressed = await render(<BuddyReactionStrip />);
    await act(async () => {});
    expect(suppressed.queryByTestId('buddy-reaction-strip')).toBeNull();
    await act(async () => { suppressed.unmount(); });

    mockReaction.presentation = 'history_only';
    const background = await render(<BuddyReactionStrip />);
    await act(async () => {});
    expect(background.queryByTestId('buddy-reaction-strip')).toBeNull();
    await act(async () => { background.unmount(); });
  });

  it('dismisses without approving or controlling anything', async () => {
    const view = await render(<BuddyReactionStrip />);
    await act(async () => {});
    fireEvent.press(view.getByTestId('buddy-reaction-strip'));
    expect(mockDismiss).toHaveBeenCalledTimes(1);
  });
});
