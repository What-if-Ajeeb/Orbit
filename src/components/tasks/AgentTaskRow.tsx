import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import type { AgentTask } from '@/lib/agent-runtime/types';
import { describeAgentTask, statusLabel, toneForStatus, type TaskTone } from '@/lib/task-workspace';
import { radius, spacing } from '@/theme';

type Props = {
  task: AgentTask;
  selected?: boolean;
  onPress: () => void;
};

function toneColor(colors: AppTheme['colors'], tone: TaskTone): string {
  switch (tone) {
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'blue':
      return colors.blue;
    default:
      return colors.textMuted;
  }
}

function toneBackground(colors: AppTheme['colors'], tone: TaskTone): string {
  switch (tone) {
    case 'success':
      return colors.successSoft;
    case 'warning':
      return colors.warningSoft;
    case 'blue':
      return colors.accentSoft;
    default:
      return colors.surfaceAlt;
  }
}

export function AgentTaskRow({ task, selected = false, onPress }: Props) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const tone = toneForStatus(task.status);
  const label = statusLabel(task.status);
  const description = describeAgentTask(task);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${task.title}, ${label}. ${description}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        selected && styles.rowSelected,
        pressed && styles.pressed,
      ]}
    >
      <View
        accessibilityRole="image"
        accessibilityLabel={`${label} status`}
        style={[styles.checkbox, { borderColor: toneColor(colors, tone) }]}
      >
        <View style={[styles.checkboxDot, { backgroundColor: toneColor(colors, tone) }]} />
      </View>

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={styles.title}>
            {task.title}
          </Text>
          <View style={[styles.status, { backgroundColor: toneBackground(colors, tone) }]}>
            <Text style={[styles.statusText, { color: toneColor(colors, tone) }]}>{label}</Text>
          </View>
        </View>
        <Text numberOfLines={2} style={styles.description}>
          {description}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
    </Pressable>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: 'transparent',
      backgroundColor: colors.surface,
    },
    rowSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    pressed: {
      opacity: 0.72,
    },
    checkbox: {
      width: 19,
      height: 19,
      borderRadius: 10,
      borderWidth: 1.5,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    body: {
      flex: 1,
      gap: 4,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    title: {
      flexShrink: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      lineHeight: 20,
    },
    status: {
      borderRadius: radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    statusText: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.2,
    },
    description: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
  });
