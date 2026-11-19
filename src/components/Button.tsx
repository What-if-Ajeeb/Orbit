import { ActivityIndicator, Pressable, StyleSheet, Text, type ViewStyle } from 'react-native';

import { colors, radius, spacing } from '@/theme';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

const backgroundByVariant: Record<ButtonVariant, string> = {
  primary: colors.accentStrong,
  secondary: colors.surfaceAlt,
  danger: colors.dangerSoft,
  ghost: 'transparent',
};

const borderByVariant: Record<ButtonVariant, string> = {
  primary: 'transparent',
  secondary: colors.border,
  danger: 'rgba(255, 107, 122, 0.32)',
  ghost: 'transparent',
};

const labelByVariant: Record<ButtonVariant, string> = {
  primary: colors.white,
  secondary: colors.text,
  danger: colors.danger,
  ghost: colors.textMuted,
};

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;

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

const styles = StyleSheet.create({
  base: {
    minHeight: 54,
    borderRadius: radius.md,
    borderWidth: 1,
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
    letterSpacing: 0.2,
  },
});
