import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import type { AgentTask } from '@/lib/agent-runtime/types';
import type { TaskGroup, TaskTone } from '@/lib/task-workspace';
import { spacing } from '@/theme';

import { AgentTaskRow } from './AgentTaskRow';

type Props = {
  group: TaskGroup;
  expanded: boolean;
  selectedTaskId: string | null;
  onToggle: () => void;
  onOpenTask: (task: AgentTask) => void;
};

function toneColor(colors: AppTheme['colors'], tone: TaskTone): string {
  if (tone === 'success') return colors.success;
  if (tone === 'warning') return colors.warning;
  if (tone === 'blue') return colors.blue;
  return colors.textMuted;
}

export function TaskGroupSection({
  group,
  expanded,
  selectedTaskId,
  onToggle,
  onOpenTask,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const visible = group.tasks.length > 0 && (!group.collapsible || expanded);

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole={group.collapsible ? 'button' : undefined}
        accessibilityLabel={
          group.collapsible
            ? `${group.title}, ${group.count} ${group.count === 1 ? 'task' : 'tasks'}. ${
                expanded ? 'Collapse' : 'Expand'
              }`
            : undefined
        }
        accessibilityState={group.collapsible ? { expanded } : undefined}
        disabled={!group.collapsible}
        onPress={group.collapsible ? onToggle : undefined}
        style={({ pressed }) => [styles.header, group.collapsible && pressed && styles.pressed]}
      >
        <View style={[styles.marker, { backgroundColor: toneColor(colors, group.tone) }]} />
        <Text accessibilityRole="header" style={styles.title}>
          {group.title}
        </Text>
        <View style={styles.count}>
          <Text style={styles.countText}>{group.count}</Text>
        </View>
        {group.collapsible ? (
          <Text style={styles.chevron}>{expanded ? '⌄' : '›'}</Text>
        ) : null}
      </Pressable>

      {visible ? (
        <View style={styles.rows}>
          {group.tasks.map((task) => (
            <AgentTaskRow
              key={task.id}
              task={task}
              selected={task.id === selectedTaskId}
              onPress={() => onOpenTask(task)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    section: {
      gap: spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.xs,
      minHeight: 34,
    },
    pressed: {
      opacity: 0.7,
    },
    marker: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    count: {
      minWidth: 22,
      borderRadius: 11,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: 6,
      paddingVertical: 2,
      alignItems: 'center',
    },
    countText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
    },
    chevron: {
      color: colors.textFaint,
      fontSize: 19,
      lineHeight: 18,
      minWidth: 18,
      textAlign: 'center',
    },
    rows: {
      gap: 6,
    },
  });
