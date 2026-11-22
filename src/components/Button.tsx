import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { radius, spacing } from '@/theme';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const { colors, glass } = useAppTheme();
  const styles = useStyles(makeStyles);
  const isDisabled = disabled || loading;

  const backgroundByVariant: Record<ButtonVariant, string> = {
    primary: colors.inverse,
    secondary: colors.surfaceAlt,
    danger: colors.dangerSoft,
    ghost: 'transparent',
  };

  const borderByVariant: Record<ButtonVariant, string> = {
    primary: 'transparent',
    secondary: glass.border,
    danger: 'transparent',
    ghost: 'transparent',
  };

  const labelByVariant: Record<ButtonVariant, string> = {
    primary: colors.onInverse,
    secondary: colors.text,
    danger: colors.danger,
    ghost: colors.textMuted,
  };

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: backgroundByVariant[variant],
          borderColor: borderByVariant[variant],
        },
        pressed && !isDisabled && styles.pressed,
        isDisabled && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={labelByVariant[variant]} />
      ) : (
        <Text style={[styles.label, { color: labelByVariant[variant] }]}>{label}</Text>
      )}
    </Pressable>
  );
}

const makeStyles = (_theme: AppTheme) =>
  StyleSheet.create({
    base: {
      minHeight: 52,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    pressed: {
      opacity: 0.85,
      transform: [{ scale: 0.995 }],
    },
    disabled: {
      opacity: 0.55,
    },
    label: {
      fontSize: 16,
      fontWeight: '600',
    },
  });
