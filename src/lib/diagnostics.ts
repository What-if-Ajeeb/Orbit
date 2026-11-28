import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Small, dependency-free crash diagnostics. A fatal JS error (or an interrupted
 * launch) is shown on screen so a release build never fails silently.
 *
 * The marker is written before providers mount and removed once the app is
 * ready. If a native crash kills the process before that point, the next
 * launch reports which stage was reached.
 */

export type DiagnosticReport = {
  phase: string;
  message: string;
  stack?: string;
  at: string;
};

const STARTUP_MARKER = 'orbit.startup.marker.v1';

let current: DiagnosticReport | null = null;
let startupStage = 'Bundle loaded';
let uiReady = false;
const listeners = new Set<() => void>();
const uiReadyListeners = new Set<() => void>();

/** Records the last completed startup stage for timeout diagnostics. */
export function markStartupStage(stage: string): void {
  startupStage = stage;
}

export function getStartupStage(): string {
  return startupStage;
}

/**
 * Signals that the root navigator mounted, i.e. the UI actually appeared.
 * Boot timeout guards use this to disarm themselves after a healthy launch.
 */
export function markUiReady(): void {
  if (uiReady) {
    return;
  }

  uiReady = true;

  for (const listener of uiReadyListeners) {
    listener();
  }
}

export function isUiReady(): boolean {
  return uiReady;
}

/** Subscribes to UI readiness; a late subscriber is notified immediately. */
export function subscribeUiReady(listener: () => void): () => void {
  uiReadyListeners.add(listener);

  if (uiReady) {
    listener();
  }

  return () => {
    uiReadyListeners.delete(listener);
  };
}

export function getDiagnosticReport(): DiagnosticReport | null {
  return current;
}

/** Dismisses a stale/interrupted-launch report once the app is actually ready. */
export function clearDiagnosticReport(): void {
  publish(null);
}

export function subscribeDiagnosticReport(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function publish(report: DiagnosticReport | null): void {
  current = report;

  for (const listener of listeners) {
    listener();
  }
}

function describe(error: unknown): Pick<DiagnosticReport, 'message' | 'stack'> {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }

  if (typeof error === 'string') {
    return { message: error };
  }

  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

/** Records an error and notifies the crash screen. Safe to call from anywhere. */
export function reportDiagnostic(phase: string, error: unknown): void {
  const { message, stack } = describe(error);

  publish({ phase, message, stack, at: new Date().toISOString() });
}

type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

type ErrorUtilsLike = {
  getGlobalHandler: () => GlobalErrorHandler;
  setGlobalHandler: (handler: GlobalErrorHandler) => void;
};

type RejectionEvent = { reason?: unknown };

type DiagnosticsScope = typeof globalThis & {
  ErrorUtils?: ErrorUtilsLike;
  onunhandledrejection?: ((event: RejectionEvent) => void) | null;
};

/** Hooks the runtime fatal-error paths once, before any provider can throw. */
export function installGlobalDiagnostics(): void {
  const scope = globalThis as DiagnosticsScope;
  const errorUtils = scope.ErrorUtils;

  if (errorUtils) {
    const previous = errorUtils.getGlobalHandler();

    errorUtils.setGlobalHandler((error, isFatal) => {
      reportDiagnostic(isFatal ? 'Fatal JavaScript error' : 'JavaScript error', error);
      previous(error, isFatal);
    });
  }

  const previousRejection = scope.onunhandledrejection;

  scope.onunhandledrejection = (event) => {
    reportDiagnostic('Unhandled promise rejection', event?.reason);
    previousRejection?.(event);
  };
}

/** Flags a launch so an interrupted startup can be reported on the next one. */
export async function markLaunchStarted(): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }

  try {
    const previous = await SecureStore.getItemAsync(STARTUP_MARKER);

    if (previous) {
      reportDiagnostic(
        'Previous launch stopped before Orbit was ready',
        new Error(`Startup marker written at ${previous}`)
      );
    }

    await SecureStore.setItemAsync(STARTUP_MARKER, new Date().toISOString());
  } catch (error) {
    // Diagnostics must never be the reason the app fails to start.
    console.warn('Could not write the startup marker.', error);
  }
}

/** Called once the session and splash are ready; a later crash is not a startup crash. */
export async function clearLaunchMarker(): Promise<void> {
  if (Platform.OS === 'web') {
    return;
  }

  try {
    await SecureStore.deleteItemAsync(STARTUP_MARKER);
  } catch (error) {
    console.warn('Could not clear the startup marker.', error);
  }
}
