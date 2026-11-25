import type { LucideIcon } from 'lucide-react-native';
import { ChevronRight } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { radius, spacing, typography } from '@/theme';

type SettingsRowProps = {
  icon: LucideIcon;
  title: string;
  description?: string;
  /** Short status shown before the chevron, e.g. "Configured" or "On". */
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  showChevron?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  role?: 'button' | 'switch';
  checked?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

/** One accessible row inside a SettingsGroup card. */
export function SettingsRow({
  icon: Icon,
  title,
  description,
  value,
  onPress,
  right,
  showChevron = true,
  destructive = false,
  disabled = false,
  role = 'button',
  checked,
  accessibilityHint,
  testID,
}: SettingsRowProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  const label = [title, description, value].filter(Boolean).join(', ');
  const content = (
    <>
      <View style={[styles.iconWrap, destructive && styles.iconWrapDestructive]}>
        <Icon
          size={18}
          color={destructive ? colors.danger : colors.accent}
          strokeWidth={2}
        />
      </View>

      <View style={styles.copy}>
        <Text
          numberOfLines={1}
          style={[styles.title, destructive && styles.titleDestructive]}
        >
          {title}
        </Text>
        {description ? (
          <Text numberOfLines={2} style={styles.description}>
            {description}
          </Text>
        ) : null}
      </View>

      {value ? (
        <Text numberOfLines={1} style={styles.value}>
          {value}
        </Text>
      ) : null}

      {right}

      {onPress && showChevron ? (
        <ChevronRight size={17} color={colors.textFaint} strokeWidth={2} />
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View accessible accessibilityLabel={label} style={styles.row}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{
        disabled,
        ...(role === 'switch' ? { checked: Boolean(checked) } : {}),
      }}
      android_ripple={{ color: colors.accentSoft }}
      disabled={disabled}
      onPress={onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.row,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {content}
    </Pressable>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    row: {
      minHeight: 58,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 1,
      backgroundColor: colors.surface,
    },
    pressed: {
      backgroundColor: colors.surfaceAlt,
    },
    disabled: {
      opacity: 0.5,
    },
    iconWrap: {
      width: 34,
      height: 34,
      borderRadius: radius.sm - 3,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    iconWrapDestructive: {
      backgroundColor: colors.dangerSoft,
    },
    copy: {
      flex: 1,
      gap: 1,
    },
    title: {
      color: colors.text,
      ...typography.body,
      fontSize: 15,
      fontWeight: '500',
    },
    titleDestructive: {
      color: colors.danger,
    },
    description: {
      color: colors.textMuted,
      ...typography.caption,
    },
    value: {
      flexShrink: 1,
      maxWidth: '38%',
      color: colors.textMuted,
      ...typography.caption,
    },
  });
