import type { PropsWithChildren, ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useStyles, type AppTheme } from '@/context/theme';
import { spacing, typography } from '@/theme';

type SettingsSectionProps = PropsWithChildren<{
  title: string;
  description?: string;
  action?: ReactNode;
}>;

/** Consistent section heading + body spacing for settings-style screens. */
export function SettingsSection({
  title,
  description,
  action,
  children,
}: SettingsSectionProps) {
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {action}
      </View>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      <View style={styles.body}>{children}</View>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    section: {
      gap: spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      minHeight: 28,
    },
    title: {
      flexShrink: 1,
      color: colors.text,
      ...typography.section,
    },
    description: {
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    body: {
      gap: spacing.md,
    },
  });
