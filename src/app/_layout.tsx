import { Stack, SplashScreen } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { FatalErrorBoundary } from '@/components/FatalErrorBoundary';
import { FatalErrorScreen } from '@/components/FatalErrorScreen';
import { SessionProvider, useSession } from '@/context/auth';
import { ThemeProvider, useAppTheme } from '@/context/theme';
import { DATABASE_NAME, migrateDbIfNeeded } from '@/lib/db';
import {
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
      <SQLiteProvider databaseName={DATABASE_NAME} onInit={initializeDatabase}>
        <ThemeProvider>
          <SessionProvider>
            <NotificationSetup />
            <SplashController />
            <HarnessProvider>
              <RootNavigator />
            </HarnessProvider>
            <StatusBarController />
          </SessionProvider>
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

function SplashController() {
  const { isLoading } = useSession();

  useEffect(() => {
    if (!isLoading) {
      void clearLaunchMarker();
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
