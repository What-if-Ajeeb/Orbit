import Ionicons from '@expo/vector-icons/Ionicons';
import {
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { radius, spacing, typography } from '@/theme';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

type StatusPillProps = {
  label: string;
  tone?: StatusTone;
  icon?: keyof typeof Ionicons.glyphMap;
  showDot?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Compact, accessible status label used for connection, sync and grant states. */
export function StatusPill({
  label,
  tone = 'neutral',
  icon,
  showDot = false,
  style,
}: StatusPillProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const iconColor: Record<StatusTone, string> = {
    neutral: colors.textMuted,
    success: colors.success,
    warning: colors.warning,
    danger: colors.danger,
    info: colors.blue,
    accent: colors.accent,
  };

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.pill, styles.tone[tone], style]}
    >
      {showDot ? <View style={[styles.dot, styles.dotTone[tone]]} /> : null}
      {icon ? <Ionicons name={icon} size={13} color={iconColor[tone]} /> : null}
      <Text style={[styles.label, styles.labelTone[tone]]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function makeStyles({ colors }: AppTheme) {
  const pill = StyleSheet.create({
    view: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      alignSelf: 'flex-start',
      maxWidth: '100%',
      minHeight: 28,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    label: {
      flexShrink: 1,
      ...typography.caption,
      fontWeight: '600',
    },
  });

  const tone: Record<StatusTone, ViewStyle> = StyleSheet.create({
    neutral: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
    success: { backgroundColor: colors.successSoft, borderColor: `${colors.success}44` },
    warning: { backgroundColor: colors.warningSoft, borderColor: `${colors.warning}44` },
    danger: { backgroundColor: colors.dangerSoft, borderColor: `${colors.danger}44` },
    info: { backgroundColor: colors.surfaceAlt, borderColor: `${colors.blue}55` },
    accent: { backgroundColor: colors.accentSoft, borderColor: `${colors.accent}44` },
  }) as Record<StatusTone, ViewStyle>;

  const dotTone: Record<StatusTone, ViewStyle> = StyleSheet.create({
    neutral: { backgroundColor: colors.textFaint },
    success: { backgroundColor: colors.success },
    warning: { backgroundColor: colors.warning },
    danger: { backgroundColor: colors.danger },
    info: { backgroundColor: colors.blue },
    accent: { backgroundColor: colors.accent },
  }) as Record<StatusTone, ViewStyle>;

  const labelTone: Record<StatusTone, TextStyle> = StyleSheet.create({
    neutral: { color: colors.textMuted },
    success: { color: colors.success },
    warning: { color: colors.warning },
    danger: { color: colors.danger },
    info: { color: colors.blue },
    accent: { color: colors.accent },
  }) as Record<StatusTone, TextStyle>;

  return { pill: pill.view, dot: pill.dot, label: pill.label, tone, dotTone, labelTone };
}
