import type { PropsWithChildren } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { useStyles, type AppTheme } from '@/context/theme';
import { elevation, radius } from '@/theme';

type GlassVariant = 'card' | 'panel' | 'pill' | 'bar';

type GlassViewProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  variant?: GlassVariant;
  /** Kept for backwards compatibility; the surface is flat now. */
  intensity?: number;
  bordered?: boolean;
  /** Kept for backwards compatibility; no highlight is drawn. */
  highlight?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}>;

/**
 * Flat rounded surface used for cards and panels. (The name is historical —
 * there is no glass or blur any more, which also makes lists much cheaper.)
 */
export function GlassView({
  children,
  style,
  variant = 'card',
  bordered = true,
  onPress,
  disabled = false,
  accessibilityLabel,
}: GlassViewProps) {
  const styles = useStyles(makeStyles);
  const surfaceStyle = [styles.base, styles[variant], bordered && styles.bordered, style];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [...surfaceStyle, pressed && styles.pressed]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={surfaceStyle}>{children}</View>;
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    base: {
      overflow: 'hidden',
    },
    card: {
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      ...elevation.card,
    },
    panel: {
      borderRadius: radius.xl,
      backgroundColor: colors.surface,
      ...elevation.raised,
    },
    pill: {
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
    },
    bar: {
      backgroundColor: colors.surface,
    },
    bordered: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    pressed: {
      opacity: 0.85,
    },
  });
