/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { Animated } from 'react-native';

import { BuddyAvatar } from './BuddyAvatar';

jest.mock('./renderer', () => ({
  renderCharacter: ({ speciesId }: any) =>
    speciesId === 'fox'
      ? require('react').createElement(require('react-native').View, { testID: 'kiko-render' })
      : null,
}));

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  const C = ({ children }: any) => <View>{children}</View>;
  return { __esModule: true, default: C, Svg: C, Circle: C, Defs: C, Ellipse: C, G: C, LinearGradient: C, Path: C, Stop: C };
});

describe('BuddyAvatar', () => {
  let loopSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    loopSpy = jest.spyOn(Animated, 'loop').mockImplementation(() => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as any));
  });

  afterEach(async () => {
    loopSpy.mockRestore();
    await act(async () => { jest.runOnlyPendingTimers(); });
    jest.useRealTimers();
  });

  it('uses character renderer for registered species', async () => {
    const view = await render(<BuddyAvatar speciesId="fox" />);
    expect(view.getByTestId('kiko-render')).toBeTruthy();
  });

  it('falls back to generic avatar for unregistered species', async () => {
    const view = await render(<BuddyAvatar speciesId="raven" />);
    await act(async () => {});
    expect(view.toJSON()).toBeTruthy();
  });
});
