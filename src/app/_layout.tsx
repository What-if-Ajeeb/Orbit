import { Stack, SplashScreen } from 'expo-router';
import { SQLiteProvider } from 'expo-sqlite';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

import { SessionProvider, useSession } from '@/context/auth';
import { ThemeProvider, useAppTheme } from '@/context/theme';
import { DATABASE_NAME, migrateDbIfNeeded } from '@/lib/db';
import { configureNotifications } from '@/lib/notifications';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <SQLiteProvider databaseName={DATABASE_NAME} onInit={migrateDbIfNeeded}>
      <ThemeProvider>
        <SessionProvider>
          <NotificationSetup />
          <SplashController />
          <RootNavigator />
          <StatusBarController />
        </SessionProvider>
      </ThemeProvider>
    </SQLiteProvider>
  );
}

function StatusBarController() {
  const { isLight } = useAppTheme();

  return <StatusBar style={isLight ? 'dark' : 'light'} />;
}

function NotificationSetup() {
  useEffect(() => {
    void configureNotifications();
  }, []);

  return null;
}

function SplashController() {
  const { isLoading } = useSession();

  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hide();
    }
  }, [isLoading]);

  return null;
}

function RootNavigator() {
  const { user } = useSession();
  const { colors } = useAppTheme();

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
