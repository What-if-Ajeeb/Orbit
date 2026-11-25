import { useStyles, type AppTheme } from '@/context/theme';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, spacing, typography } from '@/theme';


type ScreenHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
};

export function ScreenHeader({ eyebrow, title, subtitle, left, right }: ScreenHeaderProps) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.row}>
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.textBlock}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    minHeight: 52,
  },
  left: {},
  right: {
    flexShrink: 0,
  },
  textBlock: {
    flex: 1,
    gap: 4,
  },
  eyebrow: {
    color: colors.accent,
    ...typography.overline,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.serif,
    ...typography.title,
  },
  subtitle: {
    color: colors.textMuted,
    ...typography.bodySmall,
  },
  });
