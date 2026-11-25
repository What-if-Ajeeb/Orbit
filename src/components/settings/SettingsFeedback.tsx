import { CheckCircle2 } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { FormError } from '@/components/FormError';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { radius, spacing, typography } from '@/theme';

type SettingsFeedbackProps = {
  error?: string | null;
  notice?: string | null;
  onDismissError?: () => void;
};

/** Error and success banners shared by settings detail screens. */
export function SettingsFeedback({ error, notice, onDismissError }: SettingsFeedbackProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <>
      <FormError message={error ?? null} onDismiss={onDismissError} />

      {notice ? (
        <View
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={styles.notice}
        >
          <CheckCircle2 size={17} color={colors.success} strokeWidth={2} />
          <Text style={styles.noticeText}>{notice}</Text>
        </View>
      ) : null}
    </>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    notice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      backgroundColor: colors.successSoft,
      borderWidth: 1,
      borderColor: `${colors.success}47`,
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
    },
    noticeText: {
      flex: 1,
      color: colors.success,
      ...typography.bodySmall,
    },
  });
