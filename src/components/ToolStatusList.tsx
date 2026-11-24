import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import type { ToolExecutionEvent } from '@/lib/chat';
import { radius, spacing } from '@/theme';

type ToolStatusListProps = {
  events: ToolExecutionEvent[];
};

const ICONS: Record<ToolExecutionEvent['status'], keyof typeof Ionicons.glyphMap> = {
  running: 'time-outline',
  success: 'checkmark-circle-outline',
  error: 'alert-circle-outline',
  denied: 'shield-outline',
};

export function ToolStatusList({ events }: ToolStatusListProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  if (events.length === 0) {
    return null;
  }

  return (
    <View style={styles.list} accessibilityLiveRegion="polite">
      {events.map((event) => {
        const iconColor =
          event.status === 'success'
            ? colors.success
            : event.status === 'running'
              ? colors.accent
              : colors.danger;

        return (
          <View key={event.id} style={styles.row}>
            <Ionicons name={ICONS[event.status]} size={16} color={iconColor} />
            <View style={styles.copy}>
              <Text style={styles.title} numberOfLines={2}>
                {event.summary}
              </Text>
              {event.detail ? (
                <Text style={styles.detail} numberOfLines={2}>
                  {event.detail}
                </Text>
              ) : null}
            </View>
            {typeof event.durationMs === 'number' ? (
              <Text style={styles.duration}>{(event.durationMs / 1000).toFixed(1)}s</Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    list: {
      gap: spacing.xs,
      marginTop: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceAlt,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    copy: {
      flex: 1,
      gap: 2,
    },
    title: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    detail: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 16,
    },
    duration: {
      color: colors.textFaint,
      fontSize: 11,
    },
  });
