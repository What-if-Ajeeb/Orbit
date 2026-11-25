import { router, type Href } from 'expo-router';
import { ChevronLeft, Menu } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { layout, radius, spacing, typography } from '@/theme';

type SettingsHeaderProps = {
  title: string;
  right?: ReactNode;
  /** Where to go when there is no screen to return to. */
  fallback?: Href;
  onBack?: () => void;
  /** Show the workspace menu instead of a back control on root screens. */
  menu?: boolean;
};

/** Centered settings header with a back control and an optional trailing action. */
export function SettingsHeader({
  title,
  right,
  fallback = '/settings' as Href,
  onBack,
  menu = false,
}: SettingsHeaderProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { open: openSidebar } = useSidebar();

  function goBack() {
    if (onBack) {
      onBack();
      return;
    }

    if (router.canGoBack()) {
      router.back();
      return;
    }

    router.replace(fallback);
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={menu ? 'Open menu' : 'Go back'}
          hitSlop={8}
          onPress={menu ? openSidebar : goBack}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          {menu ? (
            <Menu size={22} color={colors.text} strokeWidth={2} />
          ) : (
            <ChevronLeft size={23} color={colors.text} strokeWidth={2} />
          )}
        </Pressable>

        <Text accessibilityRole="header" numberOfLines={1} style={styles.title}>
          {title}
        </Text>

        <View style={styles.iconButton}>{right ?? null}</View>
      </View>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      backgroundColor: colors.background,
    },
    bar: {
      height: 56,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing.xs,
    },
    iconButton: {
      width: layout.iconButton,
      height: layout.iconButton,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      flex: 1,
      textAlign: 'center',
      color: colors.text,
      ...typography.body,
      fontSize: 17,
      fontWeight: '600',
    },
    pressed: {
      backgroundColor: colors.surfaceAlt,
    },
  });
