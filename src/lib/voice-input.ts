import {
  ExpoSpeechRecognitionModule,
  useSpeechRecognitionEvent,
} from 'expo-speech-recognition';
import { useCallback, useEffect, useRef, useState } from 'react';

const MAX_TRANSCRIPT_CHARS = 1500;

export type VoiceInput = {
  /** Unknown until the device recognition service has been probed. */
  available: boolean | null;
  listening: boolean;
  error: string | null;
  start: (currentText: string) => Promise<void>;
  stop: () => void;
  cancel: () => void;
};

function friendlyVoiceError(code: string | undefined, message: string | undefined): string {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone or speech recognition permission was denied.';
    case 'no-speech':
    case 'speech-timeout':
      return 'No speech was detected. Try again.';
    case 'audio-capture':
      return 'The microphone could not be started.';
    case 'network':
      return 'Speech recognition needs a network connection right now.';
    case 'busy':
    case 'too-many-requests':
      return 'Speech recognition is busy. Try again in a moment.';
    default:
      return message?.trim() || 'Voice input failed. Please try again.';
  }
}

/**
 * Android speech-to-text for the agent composer. Interim results replace the
 * live draft; final results are committed to the text captured when the
 * session started. Audio is never persisted or sent anywhere by this module —
 * the recognizer is the platform service, and only the resulting text is
 * handed back to the composer.
 */
export function useVoiceInput(onTranscript: (text: string) => void): VoiceInput {
  const [available] = useState<boolean | null>(() => {
    try {
      return ExpoSpeechRecognitionModule.isRecognitionAvailable();
    } catch {
      return false;
    }
  });
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const baseRef = useRef('');
  const emitRef = useRef(onTranscript);

  useEffect(() => {
    emitRef.current = onTranscript;
  }, [onTranscript]);

  useEffect(() => {
    return () => {
      try {
        ExpoSpeechRecognitionModule.abort();
      } catch {
        // Recognition may already be stopped; abort is best-effort on unmount.
      }
    };
  }, []);

  useSpeechRecognitionEvent('start', () => {
    setListening(true);
  });

  useSpeechRecognitionEvent('result', (event) => {
    const spoken = (event.results ?? [])
      .map((result) => result.transcript)
      .join(' ')
      .trim();

    if (!spoken) {
      return;
    }

    const separator = baseRef.current ? ' ' : '';
    const draft = `${baseRef.current}${separator}${spoken}`.slice(0, MAX_TRANSCRIPT_CHARS);

    if (event.isFinal) {
      baseRef.current = draft;
    }

    emitRef.current(draft);
  });

  useSpeechRecognitionEvent('error', (event) => {
    setListening(false);

    // An abort is our own cancellation (send pressed, unmount, cancel button),
    // not a failure the user needs to see.
    if (event.error === 'aborted') {
      return;
    }

    setError(friendlyVoiceError(event.error, event.message));
  });

  useSpeechRecognitionEvent('end', () => {
    setListening(false);
  });

  const start = useCallback(async (currentText: string) => {
    setError(null);

    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();

      if (!permission.granted) {
        setError('Microphone permission is required for voice input.');
        return;
      }

      baseRef.current = currentText.trim().slice(0, MAX_TRANSCRIPT_CHARS);
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        continuous: false,
        maxAlternatives: 1,
        androidIntentOptions: { EXTRA_LANGUAGE_MODEL: 'web_search' },
      });
    } catch {
      setError('Voice input could not be started on this device.');
    }
  }, []);

  const stop = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.stop();
    } catch {
      setListening(false);
    }
  }, []);

  const cancel = useCallback(() => {
    try {
      ExpoSpeechRecognitionModule.abort();
    } catch {
      // Already stopped.
    }
    setListening(false);
  }, []);

  return { available, listening, error, start, stop, cancel };
}
