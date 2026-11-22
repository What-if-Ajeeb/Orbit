import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { radius, spacing } from '@/theme';

type FormMessageProps = {
  message: string | null;
  /** When provided, the banner shows a close button and can be dismissed. */
  onDismiss?: () => void;
};

export function FormError({ message, onDismiss }: FormMessageProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  if (!message) {
    return null;
  }

  return (
    <View accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.banner}>
      <Ionicons name="alert-circle" size={18} color={colors.danger} style={styles.icon} />
      <Text style={styles.text}>{message}</Text>
      {onDismiss ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss message"
          hitSlop={12}
          onPress={onDismiss}
          style={styles.close}
        >
          <Ionicons name="close" size={18} color={colors.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: `${colors.danger}40`,
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
    },
    icon: {
      marginTop: 1,
    },
    text: {
      flex: 1,
      color: colors.danger,
      fontSize: 14,
      lineHeight: 20,
    },
    close: {
      marginTop: 1,
    },
  });
