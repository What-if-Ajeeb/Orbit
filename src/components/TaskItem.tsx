import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDue, isPast } from '@/lib/dates';
import type { Task } from '@/lib/tasks';
import { radius, spacing } from '@/theme';


type TaskItemProps = {
  task: Task;
  onToggle: (task: Task) => void;
  onLongPress?: (task: Task) => void;
};

export function TaskItem({ task, onToggle, onLongPress }: TaskItemProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const isDone = task.status === 'done';
  const when = task.remindAt ?? task.dueAt;
  const isOverdue = !isDone && isPast(when);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={onLongPress ? 'Long press to delete' : undefined}
      onLongPress={onLongPress ? () => onLongPress(task) : undefined}
      delayLongPress={350}
      style={({ pressed }) => [styles.row, pressed && onLongPress ? styles.pressed : null]}
    >
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isDone }}
        accessibilityLabel={`Mark ${task.title} ${isDone ? 'open' : 'done'}`}
        hitSlop={8}
        onPress={() => onToggle(task)}
        style={[styles.check, isDone && styles.checkDone]}
      >
        {isDone ? <Ionicons name="checkmark" size={15} color={colors.background} /> : null}
      </Pressable>

      <View style={styles.body}>
        <Text style={[styles.title, isDone && styles.titleDone]} numberOfLines={2}>
          {task.title}
        </Text>

        <View style={styles.metaRow}>
          {when ? (
            <View style={styles.meta}>
              <Ionicons
                name={task.remindAt ? 'notifications-outline' : 'time-outline'}
                size={12}
                color={isOverdue ? colors.danger : colors.textFaint}
              />
              <Text style={[styles.metaText, isOverdue && styles.overdueText]}>
                {formatDue(when)}
              </Text>
            </View>
          ) : null}

          {task.priority === 'high' ? (
            <View style={styles.priority}>
              <Text style={styles.priorityText}>HIGH</Text>
            </View>
          ) : null}

          <Text style={styles.id}>#{task.id}</Text>
        </View>
      </View>

      {isOverdue ? <View style={styles.overdueDot} /> : null}
    </Pressable>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: glass.fillSoft,
    borderWidth: 1,
    borderColor: glass.border,
    borderTopColor: glass.borderBright,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.md,
  },
  pressed: {
    opacity: 0.7,
  },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 1.5,
    borderColor: colors.borderFocus,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  body: {
    flex: 1,
    gap: 5,
  },
  title: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 20,
  },
  titleDone: {
    color: colors.textFaint,
    textDecorationLine: 'line-through',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    color: colors.textFaint,
    fontSize: 12,
  },
  overdueText: {
    color: colors.danger,
  },
  priority: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.pill,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  priorityText: {
    color: colors.danger,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  id: {
    color: colors.textFaint,
    fontSize: 11,
  },
  overdueDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: colors.danger,
  },
  });
