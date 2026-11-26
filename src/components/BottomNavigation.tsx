import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBottomNavigation } from '@/context/bottom-navigation';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { isNavPathActive, type BottomNavSlot } from '@/lib/bottom-navigation';
import { layout, radius, spacing, typography } from '@/theme';

/** Shared with the app layout so main-screen content is never covered by the pill. */
export const BOTTOM_NAV_PILL_HEIGHT = layout.touchTarget + spacing.xs * 2;
export const BOTTOM_NAV_RESERVE = BOTTOM_NAV_PILL_HEIGHT + spacing.lg;

const BOTTOM_NAV_MAX_WIDTH = 420;

type BottomNavigationBarProps = {
  slots: readonly BottomNavSlot[];
  activePath: string | null;
  onSelect?: (slot: BottomNavSlot) => void;
  preview?: boolean;
};

function navIcon(icon: string): keyof typeof Ionicons.glyphMap {
  return icon in Ionicons.glyphMap
    ? (icon as keyof typeof Ionicons.glyphMap)
    : 'extension-puzzle-outline';
}

function activeIconFor(icon: string): string {
  return icon.endsWith('-outline') ? icon.slice(0, -'-outline'.length) : icon;
}

/** Floating three-slot pill. Also reused, without positioning, by Settings preview. */
export function BottomNavigationBar({
  slots,
  activePath,
  onSelect,
  preview = false,
}: BottomNavigationBarProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();

  return (
    <View
      pointerEvents={preview ? 'auto' : 'box-none'}
      style={[
        styles.container,
        preview ? styles.previewContainer : styles.floatingContainer,
        !preview && { bottom: Math.max(insets.bottom, spacing.sm) },
      ]}
    >
      <View accessibilityRole="tablist" testID="bottom-navigation-pill" style={styles.pill}>
        {slots.map((slot) => {
          const active = activePath ? isNavPathActive(activePath, slot.destination.href) : false;

          return (
            <Pressable
              key={slot.index}
              accessibilityRole="tab"
              accessibilityLabel={`Open ${slot.destination.label}`}
              accessibilityState={{ selected: active }}
              disabled={preview || !onSelect}
              onPress={() => onSelect?.(slot)}
              style={({ pressed }) => [
                styles.slot,
                pressed && !preview && styles.pressed,
                active && styles.slotActive,
              ]}
            >
              <Ionicons
                name={navIcon(active ? activeIconFor(slot.destination.icon) : slot.destination.icon)}
                size={20}
                color={active ? colors.accent : colors.textMuted}
              />
              <Text numberOfLines={1} style={[styles.label, active && styles.labelActive]}>
                {slot.destination.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** The live bar mounted by the shared navigation footer host. */
export function BottomNavigation() {
  const { slots } = useBottomNavigation();
  const pathname = usePathname();

  return (
    <BottomNavigationBar
      slots={slots}
      activePath={pathname}
      onSelect={(slot) => {
        router.navigate(slot.destination.href);
      }}
    />
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
    container: {
      left: 0,
      right: 0,
      alignItems: 'center',
      paddingHorizontal: spacing.lg,
    },
    floatingContainer: {
      position: 'absolute',
    },
    previewContainer: {
      width: '100%',
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      width: '100%',
      maxWidth: BOTTOM_NAV_MAX_WIDTH,
      minHeight: BOTTOM_NAV_PILL_HEIGHT,
      paddingHorizontal: spacing.xs,
      paddingVertical: spacing.xs,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.border,
      backgroundColor: colors.surface,
    },
    slot: {
      flex: 1,
      minHeight: layout.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      borderRadius: radius.md,
    },
    slotActive: {
      backgroundColor: colors.accentSoft,
    },
    pressed: {
      opacity: 0.72,
    },
    label: {
      color: colors.textMuted,
      ...typography.caption,
      fontWeight: '600',
      maxWidth: '100%',
    },
    labelActive: {
      color: colors.accent,
    },
  });
