import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useBottomNavigation } from '@/context/bottom-navigation';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { isNavPathActive, type BottomNavSlot } from '@/lib/bottom-navigation';
import { layout, radius, spacing, typography } from '@/theme';

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

/** Presentational bar, also reused by the Settings preview. Always three slots. */
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
      accessibilityRole="tablist"
      style={[
        styles.bar,
        preview && styles.preview,
        { paddingBottom: preview ? spacing.sm : Math.max(insets.bottom, spacing.sm) },
      ]}
    >
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
            <Text
              numberOfLines={1}
              style={[styles.label, active && styles.labelActive]}
            >
              {slot.destination.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function activeIconFor(icon: string): string {
  return icon.endsWith('-outline') ? icon.slice(0, -'-outline'.length) : icon;
}

/** The live bar mounted inside the authenticated app layout. */
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
    bar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      flexDirection: 'row',
      alignItems: 'flex-end',
      minHeight: layout.touchTarget + spacing.sm,
      paddingTop: spacing.sm,
      paddingHorizontal: spacing.sm,
      backgroundColor: colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: glass.border,
    },
    preview: {
      position: 'relative',
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.border,
      overflow: 'hidden',
    },
    slot: {
      flex: 1,
      minHeight: layout.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
      borderRadius: radius.sm,
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
