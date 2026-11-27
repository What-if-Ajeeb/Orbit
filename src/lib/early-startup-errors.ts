import { Alert, Platform } from 'react-native';

type ErrorHandler = (error: unknown, isFatal?: boolean) => void;

type ErrorUtilsLike = {
  getGlobalHandler?: () => ErrorHandler;
  setGlobalHandler?: (handler: ErrorHandler) => void;
};

type GlobalWithErrorUtils = typeof globalThis & {
  ErrorUtils?: ErrorUtilsLike;
  __orbitEarlyErrorHandlerInstalled?: boolean;
};

export type EarlyStartupError = {
  at: string;
  isFatal: boolean;
  message: string;
  stack?: string;
};

const captured: EarlyStartupError[] = [];
let alertShown = false;

const root = globalThis as GlobalWithErrorUtils;
const INSTALLED_FLAG = '__orbitEarlyErrorHandlerInstalled';

function describe(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }

  return { message: String(error) };
}

function showAlert(message: string, stack?: string): void {
  if (alertShown || Platform.OS === 'web') {
    return;
  }

  alertShown = true;

  try {
    const detail = stack ? stack.split('\n').slice(0, 5).join('\n') : '';
    Alert.alert(
      'Orbit startup error',
      `${message}${detail ? `\n\n${detail}` : ''}`.slice(0, 500),
      [{ text: 'OK', onPress: () => { alertShown = false; } }]
    );
  } catch {
    // Alert is best effort. The error is still captured for the diagnostic UI.
  }
}

/**
 * Installed before the root layout's other imports so failures while evaluating
 * heavy native modules are visible on the device instead of leaving a blank
 * splash screen. This module must stay dependency-free apart from React Native.
 */
if (!root[INSTALLED_FLAG] && root.ErrorUtils?.setGlobalHandler) {
  root[INSTALLED_FLAG] = true;

  const previousHandler = root.ErrorUtils.getGlobalHandler?.();

  root.ErrorUtils.setGlobalHandler((error: unknown, isFatal = false) => {
    const { message, stack } = describe(error);

    captured.push({
      at: new Date().toISOString(),
      isFatal,
      message,
      ...(stack ? { stack } : {}),
    });

    if (isFatal) {
      showAlert(message, stack);
    }

    previousHandler?.(error, isFatal);
  });
}

export function getEarlyStartupErrors(): readonly EarlyStartupError[] {
  return captured;
}
