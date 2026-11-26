import { router, type Href } from 'expo-router';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SidebarContent } from '@/components/AppSidebar';
import { useTabletLayout } from '@/context/tablet-layout';
import { useStyles, type AppTheme } from '@/context/theme';
import { spacing } from '@/theme';

/** Always-visible navigation rail/panel for landscape tablets. */
export function TabletSidebar() {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { layout, sidebarCollapsed, toggleSidebar } = useTabletLayout();

  return (
    <View
      style={[
        styles.sidebar,
        {
          width: layout.sidebarWidth,
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, spacing.md),
        },
      ]}
    >
      <SidebarContent
        variant="persistent"
        collapsed={sidebarCollapsed}
        onCollapse={toggleSidebar}
        onNavigate={(href: Href) => router.navigate(href)}
      />
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    sidebar: {
      backgroundColor: colors.background,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: colors.border,
      paddingHorizontal: spacing.md,
    },
  });
