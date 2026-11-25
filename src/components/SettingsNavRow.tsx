import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { GlassView } from '@/components/GlassView';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { layout, spacing, typography } from '@/theme';

type SettingsNavRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
  badge?: string;
  accessibilityLabel?: string;
};

/** Compact navigation row for settings and dashboard surfaces. */
export function SettingsNavRow({
  icon,
  title,
  description,
  onPress,
  badge,
  accessibilityLabel,
}: SettingsNavRowProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <GlassView
      onPress={onPress}
      accessibilityLabel={accessibilityLabel ?? title}
      style={styles.row}
    >
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={18} color={colors.accent} />
      </View>
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.description} numberOfLines={2}>
          {description}
        </Text>
      </View>
      {badge ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText} numberOfLines={1}>
            {badge}
          </Text>
        </View>
      ) : null}
      <Ionicons name="chevron-forward" size={17} style={styles.chevron} />
    </GlassView>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    row: {
      minHeight: layout.touchTarget + 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    text: {
      flex: 1,
      gap: 2,
    },
    title: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    description: {
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    badge: {
      maxWidth: 96,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: colors.surfaceAlt,
    },
    badgeText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
      textAlign: 'center',
    },
    chevron: { color: colors.textFaint },
  });
