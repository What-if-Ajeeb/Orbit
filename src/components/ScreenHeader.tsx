import { useStyles, type AppTheme } from '@/context/theme';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fonts, spacing } from '@/theme';


type ScreenHeaderProps = {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
};

export function ScreenHeader({ title, subtitle, left, right }: ScreenHeaderProps) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.row}>
      {left ? <View style={styles.left}>{left}</View> : null}
      <View style={styles.textBlock}>
        <Text accessibilityRole="header" style={styles.title}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {right ? <View>{right}</View> : null}
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
  },
  left: {},
  textBlock: {
    flex: 1,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginBottom: 6,
  },
  title: {
    color: colors.text,
    fontFamily: fonts.serif,
    fontSize: 30,
    fontWeight: '600',
    letterSpacing: -0.3,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 4,
  },
  });
