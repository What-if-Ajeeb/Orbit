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

  const dueLabel = when ? formatDue(when) : null;
  const a11yLabel = [
    task.title,
    isDone ? 'completed' : null,
    dueLabel ? `${isOverdue ? 'overdue, ' : ''}due ${dueLabel}` : null,
    task.priority === 'high' ? 'high priority' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <View style={[styles.row, isOverdue && styles.rowOverdue]}>
      {/* 26dp visual + 11dp slop each side = 48dp touch target */}
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isDone }}
        accessibilityLabel={`Mark ${task.title} ${isDone ? 'open' : 'done'}`}
        hitSlop={11}
        onPress={() => onToggle(task)}
        style={[styles.check, isDone && styles.checkDone]}
      >
        {isDone ? <Ionicons name="checkmark" size={15} color={colors.background} /> : null}
      </Pressable>

      <Pressable
        accessible
        accessibilityLabel={a11yLabel}
        accessibilityHint={onLongPress ? 'Long press for more options' : undefined}
        accessibilityActions={onLongPress ? [{ name: 'delete', label: 'Delete task' }] : undefined}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') {
            onLongPress?.(task);
          }
        }}
        onLongPress={onLongPress ? () => onLongPress(task) : undefined}
        delayLongPress={350}
        style={({ pressed }) => [styles.body, pressed && onLongPress ? styles.pressed : null]}
      >
        <Text style={[styles.title, isDone && styles.titleDone]} numberOfLines={2}>
          {task.title}
        </Text>

        <View style={styles.metaRow}>
          {dueLabel ? (
            <View style={styles.meta}>
              <Ionicons
                name={task.remindAt ? 'notifications-outline' : 'time-outline'}
                size={13}
                color={isOverdue ? colors.danger : colors.textFaint}
              />
              <Text style={[styles.metaText, isOverdue && styles.overdueText]}>
                {isOverdue ? `Overdue · ${dueLabel}` : dueLabel}
              </Text>
            </View>
          ) : null}

          {task.priority === 'high' ? (
            <View style={styles.priority}>
              <Text style={styles.priorityText}>HIGH</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
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
    minHeight: 64,
  },
  rowOverdue: {
    borderLeftWidth: 3,
    borderLeftColor: colors.danger,
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
    paddingVertical: 2,
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
    lineHeight: 16,
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
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  });
