import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurView } from 'expo-blur';
import { Tabs, router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { AppSidebar } from '@/components/AppSidebar';
import { SidebarProvider } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';

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
  const { colors, glass } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <SidebarProvider>
      <View style={styles.root}>
        <NotificationRedirect />
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarActiveTintColor: colors.accent,
            tabBarInactiveTintColor: colors.textFaint,
            tabBarHideOnKeyboard: true,
            tabBarBackground: () => (
              <BlurView
                intensity={78}
                tint={glass.tint}
                blurMethod={glass.blurMethod}
                blurReductionFactor={glass.blurReductionFactor}
                style={StyleSheet.absoluteFill}
              />
            ),
            tabBarStyle: {
              backgroundColor: 'transparent',
              borderTopColor: glass.borderBright,
              borderTopWidth: 1,
              paddingTop: 5,
            },
            tabBarLabelStyle: {
              fontSize: 11,
              fontWeight: '600',
            },
            sceneStyle: {
              backgroundColor: colors.background,
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Today',
              tabBarIcon: ({ color, size, focused }) => (
                <Ionicons
                  name={focused ? 'planet' : 'planet-outline'}
                  size={size}
                  color={typeof color === 'string' ? color : colors.textMuted}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="chat"
            options={{
              title: 'Agent',
              tabBarIcon: ({ color, size, focused }) => (
                <Ionicons
                  name={focused ? 'sparkles' : 'sparkles-outline'}
                  size={size}
                  color={typeof color === 'string' ? color : colors.textMuted}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="tasks"
            options={{
              title: 'Tasks',
              tabBarIcon: ({ color, size, focused }) => (
                <Ionicons
                  name={focused ? 'checkbox' : 'checkbox-outline'}
                  size={size}
                  color={typeof color === 'string' ? color : colors.textMuted}
                />
              ),
            }}
          />
          <Tabs.Screen
            name="settings"
            options={{
              title: 'Settings',
              tabBarIcon: ({ color, size, focused }) => (
                <Ionicons
                  name={focused ? 'settings' : 'settings-outline'}
                  size={size}
                  color={typeof color === 'string' ? color : colors.textMuted}
                />
              ),
            }}
          />
          <Tabs.Screen name="harness" options={{ href: null }} />
        </Tabs>
        <AppSidebar />
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
