import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { fonts, spacing } from '@/theme';

type EmptyStateProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

/** Friendly "nothing here yet" block with an optional single call-to-action. */
export function EmptyState({ icon, title, message, actionLabel, onAction }: EmptyStateProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.wrap}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={30} color={colors.accent} />
      </View>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.message}>{message}</Text>
      {actionLabel && onAction ? (
        <Button label={actionLabel} onPress={onAction} variant="secondary" style={styles.action} />
      ) : null}
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    wrap: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xl * 1.5,
      paddingHorizontal: spacing.lg,
      gap: spacing.sm,
    },
    iconWrap: {
      width: 68,
      height: 68,
      borderRadius: 34,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
      marginBottom: spacing.xs,
    },
    title: {
      color: colors.text,
      fontFamily: fonts.serif,
      fontSize: 22,
      fontWeight: '600',
      textAlign: 'center',
    },
    message: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 21,
      textAlign: 'center',
      maxWidth: 290,
    },
    action: {
      marginTop: spacing.md,
      minHeight: 48,
      paddingHorizontal: spacing.xl,
    },
  });
