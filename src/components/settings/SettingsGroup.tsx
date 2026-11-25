import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useStyles, type AppTheme } from '@/context/theme';
import { radius, spacing, typography } from '@/theme';

type SettingsGroupProps = {
  title?: string;
  description?: string;
  footer?: string;
  children: ReactNode;
};

/** A ChatGPT-style grouped settings card with automatic row dividers. */
export function SettingsGroup({ title, description, footer, children }: SettingsGroupProps) {
  const styles = useStyles(makeStyles);
  const rows = Children.toArray(children).filter(
    (child) => child !== null && child !== undefined
  );

  return (
    <View style={styles.group}>
      {title ? (
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
      ) : null}
      {description ? <Text style={styles.description}>{description}</Text> : null}

      <View style={styles.card}>
        {rows.map((row, index) => (
          <Fragment key={index}>
            {row}
            {index < rows.length - 1 ? <View style={styles.divider} /> : null}
          </Fragment>
        ))}
      </View>

      {footer ? <Text style={styles.footer}>{footer}</Text> : null}
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    group: {
      gap: spacing.xs,
    },
    title: {
      color: colors.textMuted,
      ...typography.caption,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      paddingHorizontal: spacing.xs,
    },
    description: {
      color: colors.textFaint,
      ...typography.caption,
      paddingHorizontal: spacing.xs,
      marginBottom: 2,
    },
    card: {
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.md,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: 62,
    },
    footer: {
      color: colors.textFaint,
      ...typography.caption,
      paddingHorizontal: spacing.xs,
      marginTop: 2,
    },
  });
