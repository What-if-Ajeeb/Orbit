/* eslint-disable react-hooks/immutability */
import { act, render } from '@testing-library/react-native';
import React from 'react';

import { useVoiceInput, type VoiceInput } from './voice-input';

jest.mock('expo-speech-recognition', () => {
  const listeners = new Map();
  const recognition = {
    isRecognitionAvailable: jest.fn(() => true),
    requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
    start: jest.fn(),
    stop: jest.fn(),
    abort: jest.fn(),
  };

  return {
    __listeners: listeners,
    __recognition: recognition,
    ExpoSpeechRecognitionModule: recognition,
    useSpeechRecognitionEvent: (name, listener) => {
      listeners.set(name, listener);
    },
  };
});

const speech = jest.requireMock('expo-speech-recognition') as {
  __listeners: Map<string, (event: unknown) => void>;
  __recognition: {
    isRecognitionAvailable: jest.Mock;
    requestPermissionsAsync: jest.Mock;
    start: jest.Mock;
    stop: jest.Mock;
    abort: jest.Mock;
  };
};

const state: { hook: VoiceInput | null } = { hook: null };
const onTranscript = jest.fn();

function Harness() {
  state.hook = useVoiceInput(onTranscript);
  return null;
}

function current(): VoiceInput {
  if (!state.hook) {
    throw new Error('Voice input hook was not rendered.');
  }

  return state.hook;
}

async function emit(name: string, event: unknown) {
  await act(async () => {
    speech.__listeners.get(name)?.(event);
  });
}

describe('useVoiceInput', () => {
  it('streams speech into the draft and handles cancellation, errors, and control', async () => {
    await render(<Harness />);

    expect(current().available).toBe(true);

    await act(async () => {
      await current().start('Hello');
    });

    expect(speech.__recognition.requestPermissionsAsync).toHaveBeenCalled();
    expect(speech.__recognition.start).toHaveBeenCalledWith(
      expect.objectContaining({ lang: 'en-US', interimResults: true })
    );

    await emit('result', { isFinal: false, results: [{ transcript: 'world' }] });
    expect(onTranscript).toHaveBeenLastCalledWith('Hello world');

    await emit('result', { isFinal: true, results: [{ transcript: 'world again' }] });
    expect(onTranscript).toHaveBeenLastCalledWith('Hello world again');

    await emit('start', null);
    expect(current().listening).toBe(true);

    await emit('error', { error: 'aborted', message: 'aborted' });
    expect(current().error).toBeNull();
    expect(current().listening).toBe(false);

    await emit('error', { error: 'not-allowed', message: 'denied' });
    expect(current().error).toMatch(/permission was denied/i);

    act(() => current().stop());
    expect(speech.__recognition.stop).toHaveBeenCalled();

    act(() => current().cancel());
    expect(speech.__recognition.abort).toHaveBeenCalled();
    expect(current().listening).toBe(false);
  });
});
