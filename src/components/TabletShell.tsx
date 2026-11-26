import Ionicons from '@expo/vector-icons/Ionicons';
import { type PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TabletContextPanel } from '@/components/TabletContextPanel';
import { TabletSidebar } from '@/components/TabletSidebar';
import { useTabletLayout } from '@/context/tablet-layout';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { layout, radius, spacing } from '@/theme';

/**
 * Phones and tablet portrait keep the existing single-column shell. Landscape
 * tablets get a persistent sidebar, independent main area and optional panel.
 */
export function TabletShell({ children }: PropsWithChildren) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { layout: responsive, contextPanelOpen, setContextPanelOpen } = useTabletLayout();

  if (!responsive.persistentSidebar) {
    return <>{children}</>;
  }

  return (
    <View
      style={[
        styles.row,
        {
          paddingLeft: insets.left,
          paddingRight: insets.right,
        },
      ]}
    >
      <TabletSidebar />

      <View style={styles.main}>{children}</View>

      {responsive.contextPanelAvailable ? (
        contextPanelOpen ? (
          <TabletContextPanel />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open context panel"
            onPress={() => setContextPanelOpen(true)}
            style={({ pressed }) => [styles.openPanel, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={19} color={colors.accent} />
            <View style={styles.openPanelLabel}>
              <Ionicons name="list-outline" size={16} color={colors.accent} />
            </View>
          </Pressable>
        )
      ) : null}
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    row: {
      flex: 1,
      flexDirection: 'row',
      backgroundColor: colors.background,
    },
    main: {
      flex: 1,
      minWidth: 0,
    },
    openPanel: {
      width: layout.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.border,
    },
    openPanelLabel: {
      width: 30,
      height: 30,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    pressed: {
      opacity: 0.72,
    },
  });
