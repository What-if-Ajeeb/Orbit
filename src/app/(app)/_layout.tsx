import { Stack, router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { AppSidebar } from '@/components/AppSidebar';
import { PermissionHost } from '@/components/permissions/PermissionHost';
import { SidebarProvider } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { setOrbitDb } from '@/lib/harness/plugins/orbit-session';
import { permissionManager } from '@/lib/permissions';

function NotificationRedirect() {
  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    let subscription: { remove: () => void } | null = null;
    let cancelled = false;

    void (async () => {
      try {
        const Notifications = await import('expo-notifications');

        if (cancelled) {
          return;
        }

        const handleResponse: Parameters<
          typeof Notifications.addNotificationResponseReceivedListener
        >[0] = (response) => {
          const url = response.notification.request.content.data?.url;

          if (typeof url === 'string') {
            router.push(url as Href);
            Notifications.clearLastNotificationResponse();
          }
        };

        const lastResponse = Notifications.getLastNotificationResponse();

        if (lastResponse) {
          handleResponse(lastResponse);
        }

        subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
      } catch (error) {
        console.warn('Notification navigation is unavailable.', error);
      }
    })();

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, []);

  return null;
}

export default function AppLayout() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();

  useEffect(() => {
    setOrbitDb(db);
    permissionManager.attach(db);
  }, [db]);

  return (
    <SidebarProvider>
      <View style={styles.root}>
        <NotificationRedirect />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="artifact" />
          <Stack.Screen name="harness" />
          <Stack.Screen name="permissions" />
          <Stack.Screen name="events" />
          <Stack.Screen name="telemetry" />
          <Stack.Screen name="policy" />
          <Stack.Screen name="buddy/tree" />
          <Stack.Screen name="buddy/evolve" />
          <Stack.Screen name="buddy/collection" />
        </Stack>
        <AppSidebar />
        <PermissionHost />
      </View>
    </SidebarProvider>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
  });
