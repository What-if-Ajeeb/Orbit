import { useStyles, type AppTheme } from '@/context/theme';
import { StyleSheet, Text, View } from 'react-native';

import { radius, spacing } from '@/theme';


type FormMessageProps = {
  message: string | null;
};

export function FormError({ message }: FormMessageProps) {
  const styles = useStyles(makeStyles);
  if (!message) {
    return null;
  }

  return (
    <View accessibilityRole="alert" style={styles.banner}>
      <View style={styles.dot} />
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: 'rgba(255, 107, 122, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 122, 0.28)',
    borderTopColor: glass.borderBright,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 6,
    backgroundColor: colors.danger,
  },
  text: {
    flex: 1,
    color: colors.danger,
    fontSize: 14,
    lineHeight: 20,
  },
  });
