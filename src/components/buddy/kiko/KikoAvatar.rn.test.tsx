/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

import { KikoAvatar } from './KikoAvatar';

const mockLoad = jest.fn(async (formId?: string) => ({
  key: formId ?? 'fox_base',
  xml: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320">
    <defs></defs>
    <g id="tail-group"><path id="tail" d="M0 0"/></g>
    <g id="body-group"><ellipse id="shadow" cx="1" cy="1" rx="1" ry="1"/><path id="body" d="M0 0"/></g>
    <g id="head-group">
      <g id="ear-left-group"></g><g id="ear-right-group"></g>
      <g id="eyes-group"><ellipse id="eye-left" cx="136" cy="132" rx="9" ry="11"/><circle id="pupil-left" cx="138" cy="129" r="3.2"/><ellipse id="eye-right" cx="184" cy="132" rx="9" ry="11"/><circle id="pupil-right" cx="186" cy="129" r="3.2"/></g>
      <path id="mouth" d="M150 173c3 4 6 6 10 6s7-2 10-6" stroke="#3A2A25" fill="none"/>
    </g>
    <g id="accessory-group"></g>
  </svg>`,
  fallback: false,
}));

jest.mock('@/lib/buddy/characters/kiko/svgLoader', () => ({
  preloadKikoAssets: jest.fn(async () => undefined),
  loadKikoFormSvg: (formId?: string) => mockLoad(formId),
  getCachedParsed: jest.fn(() => undefined),
  setCachedParsed: jest.fn(),
}));

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SvgXml: ({ xml }: any) => <View testID="svgxml" accessibilityLabel={xml} />,
  };
});

describe('KikoAvatar', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockLoad.mockClear();
  });

  afterEach(async () => {
    await act(async () => { jest.runOnlyPendingTimers(); });
    jest.useRealTimers();
  });

  it('renders loaded svg and supports form switching', async () => {
    const view = await render(<KikoAvatar formId="fox_base" />);
    await waitFor(() => expect(view.queryAllByTestId('svgxml').length).toBeGreaterThan(0));
    await view.rerender(<KikoAvatar formId="fox_base_shiny" />);
    await waitFor(() => expect(mockLoad).toHaveBeenCalledWith('fox_base_shiny'));
  });

  it('emits tap and long press state changes', async () => {
    const onStateChange = jest.fn();
    const view = await render(<KikoAvatar onStateChange={onStateChange} />);
    await waitFor(() => expect(view.getByTestId('kiko-pressable')).toBeTruthy());
    await act(async () => { fireEvent.press(view.getByTestId('kiko-pressable')); });
    await act(async () => { fireEvent(view.getByTestId('kiko-pressable'), 'longPress'); });
    expect(onStateChange).toHaveBeenCalled();
  });

  it('handles speaking prop start/stop without crashing', async () => {
    const view = await render(<KikoAvatar speaking={false} />);
    await waitFor(() => expect(view.queryAllByTestId('svgxml').length).toBeGreaterThan(0));
    await view.rerender(<KikoAvatar speaking />);
    await waitFor(() => expect(view.queryAllByTestId('svgxml').length).toBeGreaterThan(0));
    await view.rerender(<KikoAvatar speaking={false} />);
    await waitFor(() => expect(view.queryAllByTestId('svgxml').length).toBeGreaterThan(0));
  });

  it('falls back gracefully when asset load fails', async () => {
    mockLoad.mockRejectedValueOnce(new Error('boom'));
    const view = await render(<KikoAvatar formId="fox_base" />);
    await waitFor(() => expect(view.getByText('Kiko')).toBeTruthy());
    expect(view.getByText('Asset loading failed')).toBeTruthy();
  });
});
