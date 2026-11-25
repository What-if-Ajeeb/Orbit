import { Tabs } from 'expo-router';

import { useAppTheme } from '@/context/theme';
import { layout, spacing } from '@/theme';

export default function TabLayout() {
  const { colors } = useAppTheme();

  return (
    <Tabs
      backBehavior="history"
      screenOptions={{
        headerShown: false,
        // Navigation lives in the drawer and the customizable bottom bar.
        tabBarStyle: { display: 'none' },
        sceneStyle: {
          backgroundColor: colors.background,
          paddingBottom: layout.touchTarget + spacing.md,
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
    </Tabs>
  );
}
