import { Tabs, router, type Href } from 'expo-router';
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
        <Tabs
          screenOptions={{
            headerShown: false,
            // Navigation lives in the drawer (hamburger, top-left), like a chat app.
            tabBarStyle: { display: 'none' },
            sceneStyle: {
              backgroundColor: colors.background,
            },
          }}
        >
          <Tabs.Screen name="index" />
          <Tabs.Screen name="chat" />
          <Tabs.Screen name="buddy" />
          <Tabs.Screen name="tasks" />
          <Tabs.Screen name="workflows" />
          <Tabs.Screen name="artifacts" />
          <Tabs.Screen name="settings" />
          {/* Detail and advanced screens stay reachable from in-app links; they are not tabs. */}
          <Tabs.Screen name="artifact" options={{ href: null }} />
          <Tabs.Screen name="harness" options={{ href: null }} />
          <Tabs.Screen name="permissions" options={{ href: null }} />
          <Tabs.Screen name="events" options={{ href: null }} />
          <Tabs.Screen name="telemetry" options={{ href: null }} />
          <Tabs.Screen name="policy" options={{ href: null }} />
        </Tabs>
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
