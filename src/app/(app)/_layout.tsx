import { Stack, router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useSQLiteContext } from 'expo-sqlite';

import { AppSidebar } from '@/components/AppSidebar';
import { NavigationFooter } from '@/components/NavigationFooter';
import { OrientationController } from '@/components/OrientationController';
import { PermissionHost } from '@/components/permissions/PermissionHost';
import { PluginApprovalHost } from '@/components/plugins/PluginApprovalHost';
import { TabletShell } from '@/components/TabletShell';
import { BottomNavigationProvider } from '@/context/bottom-navigation';
import { NavigationFooterProvider, useNavigationFooter } from '@/context/navigation-footer';
import { PinnedPluginsProvider } from '@/context/pinned-plugins';
import { SidebarProvider } from '@/context/sidebar';
import { PluginPlatformProvider } from '@/context/plugins';
import { TabletLayoutProvider, useTabletLayout } from '@/context/tablet-layout';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { setOrbitDb } from '@/lib/harness/plugins/orbit-session';
import { permissionManager } from '@/lib/permissions';
import { SafetyTrash } from '@/lib/safety/trash';

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
            router.navigate(url as Href);
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

function SafetyLifecycle() {
  const db = useSQLiteContext();

  useEffect(() => {
    void new SafetyTrash(db).purgeExpired().catch(() => {
      // Retention cleanup is best effort; a failure must not block the app.
    });
  }, [db]);

  return null;
}

function AppLayoutContent() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { layout: responsive } = useTabletLayout();
  const { reserve } = useNavigationFooter();

  useEffect(() => {
    setOrbitDb(db);
    permissionManager.attach(db);
  }, [db]);

  return (
    <View style={styles.root}>
      <OrientationController />
      <NotificationRedirect />
      <SafetyLifecycle />

      <TabletShell>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: {
              backgroundColor: colors.background,
              // Applied once, only on routes that show the floating footer.
              paddingBottom: reserve,
            },
            animation: 'slide_from_right',
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="projects" />
          <Stack.Screen name="artifact" />
          <Stack.Screen name="agents/index" />
          <Stack.Screen name="agents/[agentId]/index" />
          <Stack.Screen name="agents/[agentId]/tools" />
          <Stack.Screen name="conversations" />
          <Stack.Screen name="connections" />
          <Stack.Screen name="marketplace" />
          <Stack.Screen name="tool-permissions" />
          <Stack.Screen name="approvals" />
          <Stack.Screen name="harness" />
          <Stack.Screen name="permissions" />
          <Stack.Screen name="events" />
          <Stack.Screen name="telemetry" />
          <Stack.Screen name="policy" />
          <Stack.Screen name="plugins/index" />
          <Stack.Screen name="plugins/my-plugins" />
          <Stack.Screen name="plugins/builder" />
          <Stack.Screen name="plugins/[pluginId]" />
          <Stack.Screen name="plugin/[pluginId]" />
          <Stack.Screen name="settings/artifacts" />
          <Stack.Screen name="settings/appearance" />
          <Stack.Screen name="settings/ai-connection" />
          <Stack.Screen name="settings/models" />
          <Stack.Screen name="settings/memory" />
          <Stack.Screen name="settings/mcp" />
          <Stack.Screen name="settings/navigation" />
          <Stack.Screen name="settings/notifications" />
          <Stack.Screen name="settings/data" />
          <Stack.Screen name="settings/account" />
          <Stack.Screen name="buddy/tree" />
          <Stack.Screen name="buddy/evolve" />
          <Stack.Screen name="buddy/collection" />
        </Stack>
      </TabletShell>

      <NavigationFooter />
      {!responsive.persistentSidebar ? <AppSidebar /> : null}
      <PermissionHost />
      <PluginApprovalHost />
    </View>
  );
}

export default function AppLayout() {
  return (
    <PluginPlatformProvider>
      <BottomNavigationProvider>
        <SidebarProvider>
          <PinnedPluginsProvider>
            <TabletLayoutProvider>
              <NavigationFooterProvider>
                <AppLayoutContent />
              </NavigationFooterProvider>
            </TabletLayoutProvider>
          </PinnedPluginsProvider>
        </SidebarProvider>
      </BottomNavigationProvider>
    </PluginPlatformProvider>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
  });
