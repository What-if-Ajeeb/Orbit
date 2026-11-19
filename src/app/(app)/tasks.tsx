import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { TaskItem } from '@/components/TaskItem';
import { useSession } from '@/context/auth';
import { parseTaskText } from '@/lib/dates';
import {
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  reopenTask,
  type Task,
  type TaskStatus,
} from '@/lib/tasks';
import { colors, radius, spacing } from '@/theme';

type Filter = TaskStatus | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
];

export default function TasksScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [text, setText] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (showSpinner = false) => {
      if (!user) {
        return;
      }

      if (showSpinner) {
        setIsRefreshing(true);
      }

      try {
        const nextTasks = await listTasks(db, user.id, { status: filter, limit: 100 });
        setTasks(nextTasks);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load tasks.');
      } finally {
        if (showSpinner) {
          setIsRefreshing(false);
        }
      }
    },
    [db, filter, user]
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!user) {
    return null;
  }

  const activeUser = user;

  async function addTask() {
    const raw = text.trim();

    if (!raw || isAdding) {
      return;
    }

    setIsAdding(true);
    setError(null);

    try {
      const parsed = parseTaskText(raw);
      await createTask(db, activeUser.id, {
        title: parsed.title || raw,
        dueAt: parsed.dueAt,
      });

      setText('');
      setFilter('open');
      await load();
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Could not add the task.');
    } finally {
      setIsAdding(false);
    }
  }

  async function toggleTask(task: Task) {
    try {
      if (task.status === 'done') {
        await reopenTask(db, activeUser.id, task.id);
      } else {
        await completeTask(db, activeUser.id, task.id);
      }

      await load();
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : 'Could not update the task.');
    }
  }

  function confirmDelete(task: Task) {
    Alert.alert('Delete task?', task.title, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await deleteTask(db, activeUser.id, task.id);
              await load();
            } catch (deleteError) {
              setError(
                deleteError instanceof Error ? deleteError.message : 'Could not delete the task.'
              );
            }
          })();
        },
      },
    ]);
  }

  const emptyTitle =
    filter === 'done' ? 'No completed tasks yet' : filter === 'all' ? 'No tasks yet' : 'All clear';
  const emptyText =
    filter === 'done'
      ? 'Complete a task and it will show up here.'
      : 'Naya task add karo — ya Agent se bolwao.';

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.glow} />

      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <ScreenHeader
          eyebrow="LOCAL TASKS"
          title="Tasks"
          subtitle={`${tasks.length} ${filter === 'all' ? 'total' : filter} task${tasks.length === 1 ? '' : 's'}`}
        />

        <View style={styles.addRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Add task — try “pay bill tomorrow 5pm”"
            placeholderTextColor={colors.textFaint}
            selectionColor={colors.accent}
            style={styles.addInput}
            returnKeyType="done"
            onSubmitEditing={() => {
              void addTask();
            }}
            maxLength={300}
          />

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add task"
            disabled={isAdding || text.trim().length === 0}
            onPress={() => {
              void addTask();
            }}
            style={({ pressed }) => [
              styles.addButton,
              (isAdding || text.trim().length === 0) && styles.addDisabled,
              pressed && styles.pressed,
            ]}
          >
            {isAdding ? (
              <ActivityIndicator size="small" color={colors.white} />
            ) : (
              <Ionicons name="add" size={23} color={colors.white} />
            )}
          </Pressable>
        </View>

        {error ? (
          <Pressable onPress={() => setError(null)} style={styles.errorBanner}>
            <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </Pressable>
        ) : null}

        <View style={styles.filters}>
          {FILTERS.map((item) => {
            const active = filter === item.id;

            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setFilter(item.id)}
                style={[styles.filter, active && styles.filterActive]}
              >
                <Text style={[styles.filterText, active && styles.filterTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <FlatList
        data={tasks}
        keyExtractor={(task) => String(task.id)}
        contentContainerStyle={styles.listContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              void load(true);
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }
        renderItem={({ item }) => (
          <TaskItem task={item} onToggle={toggleTask} onLongPress={confirmDelete} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="checkmark-done-circle-outline" size={34} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>{emptyTitle}</Text>
            <Text style={styles.emptyText}>{emptyText}</Text>
          </View>
        }
        ListFooterComponent={
          tasks.length > 0 ? (
            <Text style={styles.footerHint}>Long-press a task to delete it.</Text>
          ) : undefined
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  glow: {
    position: 'absolute',
    top: -170,
    left: -110,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.accentSoft,
  },
  header: {
    paddingHorizontal: spacing.lg,
  },
  addRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  addInput: {
    flex: 1,
    minHeight: 50,
    color: colors.text,
    fontSize: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  addButton: {
    width: 50,
    height: 50,
    borderRadius: radius.md,
    backgroundColor: colors.accentStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addDisabled: {
    opacity: 0.45,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: 'rgba(255, 107, 122, 0.25)',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  errorText: {
    flex: 1,
    color: colors.danger,
    fontSize: 12,
    lineHeight: 17,
  },
  filters: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.pill,
    padding: 4,
    marginTop: spacing.md,
  },
  filter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  filterActive: {
    backgroundColor: colors.accentSoft,
  },
  filterText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  filterTextActive: {
    color: colors.accent,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
  },
  separator: {
    height: spacing.sm,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    lineHeight: 19,
    maxWidth: 280,
  },
  footerHint: {
    color: colors.textFaint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  pressed: {
    opacity: 0.8,
  },
});
