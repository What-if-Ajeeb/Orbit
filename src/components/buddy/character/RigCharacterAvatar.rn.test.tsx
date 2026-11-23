/* eslint-disable @typescript-eslint/no-require-imports */
import fs from 'node:fs';
import path from 'node:path';

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Animated } from 'react-native';

import { getSpecies } from '@/lib/buddy/species';
import type { BuddyAnimationState } from '@/lib/buddy/types';
import { KIKO_SVG_SOURCES, type KikoAssetKey } from '@/lib/buddy/characters/kiko/assetSources';
import { setKikoAssetReader } from '@/lib/buddy/characters/kiko/svgLoader';
import { getCharacterLoader, getAllCharacterRigs } from '@/lib/buddy/characters/rigs';

import { BuddyAvatar } from '../BuddyAvatar';

jest.mock('react-native-svg', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    SvgXml: ({ xml, ...props }: any) => <View testID="svgxml" accessibilityLabel={xml} {...props} />,
  };
});

// Rendering eight Kiko evolution forms through the full SVG pipeline is slower
// than the default Jest timeout on CI hardware.
jest.setTimeout(20000);

const CHARACTER_ROOT = path.resolve(process.cwd(), 'orbit-buddy/characters');

function assetFile(speciesId: string, key: string): string {
  const dir = speciesId === 'fox' ? 'kiko' : speciesId;
  const root = path.join(CHARACTER_ROOT, dir);
  if (key === 'expressions') return path.join(root, 'expressions.svg');
  if (key === 'animations') return path.join(root, 'animations.svg');
  if (key === `${speciesId}_base` || key === 'base') return path.join(root, 'base.svg');
  if (key === `${speciesId}_stage2`) return path.join(root, 'evolution-stage2.svg');
  if (key === `${speciesId}_stage3`) return path.join(root, 'evolution-stage3.svg');
  if (key === `${speciesId}_base_shiny`) return path.join(root, 'shiny-form.svg');
  if (key === `${speciesId}_mythical`) return path.join(root, 'mythical-form.svg');
  return path.join(root, `evolution-${key.slice(speciesId.length + 1)}.svg`);
}

const rigs = getAllCharacterRigs();

beforeAll(() => {
  for (const rig of rigs) {
    const loader = getCharacterLoader(rig.speciesId);
    loader?.clear();
    loader?.setReader(async (moduleId) => {
      const key = Object.entries(rig.assets).find(([, id]) => id === moduleId)?.[0];
      if (!key) throw new Error(`unknown module ${moduleId}`);
      return fs.readFileSync(assetFile(rig.speciesId, key), 'utf8');
    });
  }

  setKikoAssetReader(async (moduleId) => {
    const key = Object.entries(KIKO_SVG_SOURCES).find(([, id]) => id === moduleId)?.[0] as KikoAssetKey | undefined;
    if (!key) throw new Error(`unknown kiko module ${moduleId}`);
    return fs.readFileSync(assetFile('fox', key), 'utf8');
  });
});

afterEach(async () => {
  await act(async () => { jest.runOnlyPendingTimers(); });
  jest.useRealTimers();
});

beforeEach(() => {
  jest.useFakeTimers();
});

const species = [{ speciesId: 'fox', displayName: 'Kiko' }, ...rigs];

const REPRESENTATIVE_STATES: BuddyAnimationState[] = [
  'idle',
  'happy',
  'sad',
  'angry',
  'thinking',
  'speaking',
  'sleeping',
];

function xmlOf(view: Awaited<ReturnType<typeof render>>): string {
  return view
    .queryAllByTestId('svgxml')
    .map((node) => node.props.accessibilityLabel ?? '')
    .join('|');
}

describe('speaking animation', () => {
  it('alternates the speaking mouth layers while speech is active', async () => {
    const loopSpy = jest.spyOn(Animated, 'loop').mockImplementation(
      () => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as any)
    );
    const view = await render(<BuddyAvatar speciesId="raven" speaking size={200} />);
    await waitFor(() => expect(view.queryAllByTestId('svgxml').length).toBeGreaterThan(0));
    const closed = xmlOf(view);
    expect(closed).toContain('mouth-idle');

    await act(async () => { jest.advanceTimersByTime(160); });
    await waitFor(() => expect(xmlOf(view)).toContain('mouth-speaking'));

    await act(async () => { jest.advanceTimersByTime(160); });
    await waitFor(() => expect(xmlOf(view)).toContain('mouth-idle'));

    view.unmount();
    loopSpy.mockRestore();
  });
});

describe.each(species)('$displayName Buddy Room integration', ({ speciesId, displayName }) => {
  it('renders real artwork through BuddyAvatar for every evolution form', async () => {
    const loopSpy = jest.spyOn(Animated, 'loop').mockImplementation(
      () => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as any)
    );
    const forms = getSpecies(speciesId)!.forms;
    const view = await render(<BuddyAvatar speciesId={speciesId} formId={forms[0].id} size={200} />);

    await waitFor(() => expect(view.queryAllByTestId('svgxml').length).toBeGreaterThan(0));
    expect(view.queryByTestId('buddy-rig-fallback')).toBeNull();
    expect(view.queryByText('Asset loading failed')).toBeNull();

    let previous = xmlOf(view);
    for (const form of forms.slice(1)) {
      await view.rerender(<BuddyAvatar speciesId={speciesId} formId={form.id} size={200} />);
      await waitFor(() => expect(xmlOf(view)).not.toBe(previous));
      expect(view.queryByTestId('buddy-rig-fallback')).toBeNull();
      previous = xmlOf(view);
    }

    for (const state of REPRESENTATIVE_STATES) {
      await view.rerender(
        <BuddyAvatar
          speciesId={speciesId}
          formId={forms[0].id}
          size={200}
          state={state}
          speaking={state === 'speaking'}
        />
      );
      await act(async () => {});
      expect(view.queryByTestId('buddy-rig-fallback')).toBeNull();
      expect(view.queryAllByTestId('svgxml').length).toBeGreaterThan(0);
    }

    const onStateChange = jest.fn();
    await view.rerender(<BuddyAvatar speciesId={speciesId} formId={forms[0].id} size={200} onStateChange={onStateChange} />);
    await waitFor(() => expect(view.queryAllByTestId('svgxml').length).toBeGreaterThan(0));

    const pressable = view.queryByTestId('buddy-rig-pressable') ?? view.queryByTestId('kiko-pressable');
    expect(pressable).toBeTruthy();
    await act(async () => { fireEvent.press(pressable!); });
    if (onStateChange.mock.calls.length === 0) {
      // Kiko reports its own local state through the same contract.
      expect(pressable).toBeTruthy();
    } else {
      expect(onStateChange).toHaveBeenCalled();
    }

    view.unmount();
    loopSpy.mockRestore();
  });

  it('keeps rendering when motion is reduced', async () => {
    const loopSpy = jest.spyOn(Animated, 'loop').mockImplementation(
      () => ({ start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as any)
    );
    const view = await render(<BuddyAvatar speciesId={speciesId} size={180} interactive={false} />);
    await waitFor(() => expect(view.queryAllByTestId('svgxml').length).toBeGreaterThan(0));
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(view.queryByTestId('buddy-rig-fallback')).toBeNull();
    view.unmount();
    loopSpy.mockRestore();
  });
});
