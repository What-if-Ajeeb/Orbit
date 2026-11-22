import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
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

import { EmptyState } from '@/components/EmptyState';
import { FormError } from '@/components/FormError';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { Skeleton } from '@/components/Skeleton';
import { TaskItem } from '@/components/TaskItem';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
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
import { radius, spacing } from '@/theme';


type Filter = TaskStatus | 'all';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'Open' },
  { id: 'done', label: 'Done' },
  { id: 'all', label: 'All' },
];

export default function TasksScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  const [text, setText] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
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
        setIsLoaded(true);

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
      : 'Add a task above, or ask the agent.';

  return (
    <View style={styles.root}>
      <GlassBackdrop />

      <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
        <ScreenHeader
          eyebrow="LOCAL TASKS"
          title="Tasks"
          subtitle={`${tasks.length} ${filter === 'all' ? 'total' : filter} task${tasks.length === 1 ? '' : 's'}`}
          left={<SidebarButton onPress={openSidebar} />}
        />

        <View style={styles.addRow}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Add task — try “pay bill tomorrow 5pm”"
            accessibilityLabel="New task"
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
          <View style={styles.errorWrap}>
            <FormError message={error} onDismiss={() => setError(null)} />
          </View>
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
        contentContainerStyle={[styles.listContent, { paddingBottom: spacing.xl + insets.bottom }]}
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
          !isLoaded ? (
            <View style={styles.skeletonList}>
              <Skeleton height={64} radius={radius.md} />
              <Skeleton height={64} radius={radius.md} />
              <Skeleton height={64} radius={radius.md} />
            </View>
          ) : (
            <EmptyState
              icon={filter === 'done' ? 'checkmark-done-outline' : 'checkmark-done-circle-outline'}
              title={emptyTitle}
              message={emptyText}
            />
          )
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

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
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
    backgroundColor: glass.fillSoft,
    borderWidth: 1,
    borderColor: glass.border,
    borderTopColor: glass.borderBright,
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
  errorWrap: {
    marginTop: spacing.sm,
  },
  filters: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: glass.fillStrong,
    borderWidth: 1,
    borderColor: glass.border,
    borderRadius: radius.pill,
    padding: 4,
    marginTop: spacing.md,
  },
  filter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
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
  skeletonList: {
    gap: spacing.sm,
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
