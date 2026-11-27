// Keep this first: it installs a global error handler before the heavy native
// modules below are evaluated, so import-time crashes are visible on the phone.
import { getEarlyStartupErrors } from '@/lib/early-startup-errors';

import { Stack, SplashScreen } from 'expo-router';
import { SQLiteProvider, useSQLiteContext, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { FatalErrorBoundary } from '@/components/FatalErrorBoundary';
import { FatalErrorScreen } from '@/components/FatalErrorScreen';
import { SessionProvider, useSession } from '@/context/auth';
import { ThemeProvider, useAppTheme } from '@/context/theme';
import { PaperThemeBridge } from '@/context/paper';
import { DATABASE_NAME, migrateDbIfNeeded } from '@/lib/db';
import {
  clearDiagnosticReport,
  clearLaunchMarker,
  getStartupStage,
  installGlobalDiagnostics,
  markLaunchStarted,
  markStartupStage,
  reportDiagnostic,
} from '@/lib/diagnostics';
import { HarnessProvider } from '@/lib/harness/spine/boot';
import { configureNotifications } from '@/lib/notifications';

void SplashScreen.preventAutoHideAsync();
installGlobalDiagnostics();
markStartupStage('Runtime diagnostics installed');
void markLaunchStarted();

const BOOT_WATCHDOG_MS = 12000;

/**
 * Lives outside SQLiteProvider so it still runs if database initialization hangs
 * and the provider never renders its children.
 */
function BootWatchdog() {
  useEffect(() => {
    const timer = setTimeout(() => {
      const early = getEarlyStartupErrors();
      const earlyDetail = early.length > 0 ? ` Early error: ${early[0]!.message}` : '';

      reportDiagnostic(
        'Boot watchdog',
        new Error(
          `UI did not appear within ${BOOT_WATCHDOG_MS / 1000}s. ` +
            `Last stage: ${getStartupStage()}.${earlyDetail}`
        )
      );
      void SplashScreen.hide();
    }, BOOT_WATCHDOG_MS);

    return () => clearTimeout(timer);
  }, []);

  return null;
}

async function initializeDatabase(db: SQLiteDatabase): Promise<void> {
  try {
    markStartupStage('Database initialization started');
    await migrateDbIfNeeded(db);
    markStartupStage('Database ready');
  } catch (error) {
    reportDiagnostic('Database initialization', error);
    throw error;
  }
}

export default function RootLayout() {
  return (
    <FatalErrorBoundary>
      <BootWatchdog />
      <SQLiteProvider
        databaseName={DATABASE_NAME}
        onInit={initializeDatabase}
        onError={(error: Error) => {
          reportDiagnostic('Database provider', error);
        }}
      >
        <ThemeProvider>
          <PaperThemeBridge>
            <SessionProvider>
              <NotificationSetup />
              <AgentRuntimeRecovery />
              <SandboxLifecycle />
              <SplashController />
              <HarnessProvider>
                <RootNavigator />
              </HarnessProvider>
              <StatusBarController />
            </SessionProvider>
          </PaperThemeBridge>
        </ThemeProvider>
      </SQLiteProvider>
      <FatalErrorScreen />
    </FatalErrorBoundary>
  );
}

function StatusBarController() {
  const { isLight } = useAppTheme();

  return <StatusBar style={isLight ? 'dark' : 'light'} />;
}

function NotificationSetup() {
  useEffect(() => {
    void configureNotifications().catch((error: unknown) => {
      reportDiagnostic('Notification setup', error);
    });
  }, []);

  return null;
}

/**
 * Importing the scheduler registers the Android background task at module scope.
 * That graph is large (orchestrator, hermes, workflows, hybrid recovery). Loading
 * it only after the session path is live keeps a failure there from killing first
 * paint. The effect still recovers interrupted work and keeps the WorkManager
 * worker registered for later app-closed periods.
 */
function AgentRuntimeRecovery() {
  const db = useSQLiteContext();
  const { user } = useSession();
  const userId = user?.id;

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        markStartupStage('Agent recovery import started');
        const { recoverAgentRuntimeOnStartup } = await import(
          '@/lib/agent-runtime/scheduler'
        );
        if (cancelled) return;
        markStartupStage('Agent recovery running');
        await recoverAgentRuntimeOnStartup(db, userId);
        if (!cancelled) {
          markStartupStage('Agent recovery complete');
        }
      } catch (error: unknown) {
        if (!cancelled) {
          reportDiagnostic('Agent recovery', error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [db, userId]);

  return null;
}

function SandboxLifecycle() {
  useEffect(() => {
    return () => {
      void (async () => {
        try {
          const { disposeMobileSandboxManager } = await import('@/lib/sandbox/manager');
          await disposeMobileSandboxManager();
        } catch {
          // The service may already be gone during shutdown; cleanup is best effort.
        }
      })();
    };
  }, []);

  return null;
}

function SplashController() {
  const { isLoading } = useSession();

  useEffect(() => {
    if (!isLoading) {
      void clearLaunchMarker();
      // A stale marker from an older crash is no longer relevant: the app is
      // live now, so remove the report before it hides the real UI.
      clearDiagnosticReport();
      markStartupStage('Session ready');
      SplashScreen.hide();
      return;
    }

    // A provider that never resolves used to leave the native splash up with
    // no explanation. Surface the last completed stage and let the UI render.
    const timeout = setTimeout(() => {
      reportDiagnostic(
        'Startup timed out',
        new Error(`Last completed stage: ${getStartupStage()}`)
      );
      SplashScreen.hide();
    }, 8000);

    return () => clearTimeout(timeout);
  }, [isLoading]);

  return null;
}

function RootNavigator() {
  const { user } = useSession();
  const { colors } = useAppTheme();

  useEffect(() => {
    markStartupStage('Navigator rendered');
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={Boolean(user)}>
        <Stack.Screen name="(app)" />
      </Stack.Protected>

      <Stack.Protected guard={!user}>
        <Stack.Screen name="sign-in" />
        <Stack.Screen name="sign-up" />
      </Stack.Protected>
    </Stack>
  );
}
