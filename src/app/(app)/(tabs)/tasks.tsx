import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand } from '@/components/Brand';
import { EmptyState } from '@/components/EmptyState';
import { FormError } from '@/components/FormError';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { SidebarButton } from '@/components/SidebarButton';
import { Skeleton } from '@/components/Skeleton';
import { TaskItem } from '@/components/TaskItem';
import { TaskDetail } from '@/components/tasks/TaskDetail';
import { TaskGroupSection } from '@/components/tasks/TaskGroupSection';
import { TaskWorkspaceControls } from '@/components/tasks/TaskWorkspaceControls';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useTabletLayout } from '@/context/tablet-layout';
import type { AgentTask } from '@/lib/agent-runtime/types';
import { listAgentTasks } from '@/lib/agent-runtime/task-manager';
import { parseTaskText } from '@/lib/dates';
import {
  completeTask,
  createTask,
  deleteTask,
  listTasks,
  reopenTask,
  type Task,
} from '@/lib/tasks';
import {
  TASK_SORT_MODES,
  buildTaskGroups,
  filterPersonalTasks,
  getTaskWorkspaceState,
  updateTaskWorkspaceState,
  type TaskGroup,
  type TaskSortMode,
  type TaskWorkspaceTab,
} from '@/lib/task-workspace';
import { fonts, radius, spacing } from '@/theme';

type PersonalSection = {
  title: string;
  data: Task[];
  collapsible?: boolean;
};

type AgentSection = TaskGroup & { data: AgentTask[] };

export default function TasksScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const { layout } = useTabletLayout();

  const [initial] = useState(() => getTaskWorkspaceState());
  const [tab, setTab] = useState<TaskWorkspaceTab>(initial.tab);
  const [sort, setSort] = useState<TaskSortMode>(initial.sort);
  const [query, setQuery] = useState(initial.query);
  const [searchOpen, setSearchOpen] = useState(initial.query.length > 0);
  const [resolvedExpanded, setResolvedExpanded] = useState(initial.resolvedExpanded);
  const [personalResolvedExpanded, setPersonalResolvedExpanded] = useState(initial.resolvedExpanded);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initial.selectedTaskId);
  const [agentTasks, setAgentTasks] = useState<AgentTask[]>([]);
  const [personalTasks, setPersonalTasks] = useState<Task[]>([]);
  const [newTaskText, setNewTaskText] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeListRef = useRef<SectionList<AgentTask, AgentSection>>(null);
  const personalListRef = useRef<SectionList<Task, PersonalSection>>(null);

  const showSplit = layout.isTablet || (Platform.OS === 'web' && layout.width >= 900);

  const load = useCallback(
    async (showSpinner = false) => {
      if (!user) {
        return;
      }

      if (showSpinner) {
        setIsRefreshing(true);
      }

      try {
        const [agent, personal] = await Promise.all([
          listAgentTasks(db, user.id, 200),
          listTasks(db, user.id, { status: 'all', limit: 100 }),
        ]);

        setAgentTasks(agent);
        setPersonalTasks(personal);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : 'Could not load tasks.');
      } finally {
        setIsLoaded(true);

        if (showSpinner) {
          setIsRefreshing(false);
        }
      }
    },
    [db, user]
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    updateTaskWorkspaceState({ tab, sort, query, resolvedExpanded, selectedTaskId });
  }, [query, resolvedExpanded, selectedTaskId, sort, tab]);

  useFocusEffect(
    useCallback(() => {
      const offset = getTaskWorkspaceState().scroll[tab];
      const frame = requestAnimationFrame(() => {
        const scrollTo = (list: { getScrollResponder: () => { scrollTo: (options: { y: number; animated: boolean }) => void } | null | undefined } | null) => {
          list?.getScrollResponder()?.scrollTo({ y: offset, animated: false });
        };

        if (tab === 'active') {
          scrollTo(activeListRef.current);
        } else {
          scrollTo(personalListRef.current);
        }
      });

      return () => cancelAnimationFrame(frame);
    }, [tab])
  );

  const groups = useMemo(
    () => buildTaskGroups(agentTasks, { query, sort }),
    [agentTasks, query, sort]
  );

  const activeSections = useMemo<AgentSection[]>(
    () =>
      groups
        .filter((group) => group.count > 0)
        .map((group) => ({ ...group, data: group.tasks })),
    [groups]
  );

  const personalSections = useMemo<PersonalSection[]>(() => {
    const open = filterPersonalTasks(
      personalTasks.filter((task) => task.status === 'open'),
      query,
      sort
    );
    const done = filterPersonalTasks(
      personalTasks.filter((task) => task.status === 'done'),
      query,
      sort
    );

    return [
      { title: 'Up next', data: open },
      { title: 'Resolved', data: done, collapsible: true },
    ].filter((section) => section.data.length > 0 || section.title === 'Up next');
  }, [personalTasks, query, sort]);

  const activeCount = groups
    .filter((group) => group.id !== 'resolved')
    .reduce((total, group) => total + group.count, 0);
  const resolvedCount = groups.find((group) => group.id === 'resolved')?.count ?? 0;
  const totalCount = tab === 'active' ? agentTasks.length : personalTasks.length;

  if (!user) {
    return null;
  }

  const activeUser = user;

  function selectTab(next: TaskWorkspaceTab) {
    setTab(next);
    updateTaskWorkspaceState({ tab: next });
  }

  function cycleSort() {
    const index = TASK_SORT_MODES.indexOf(sort);
    const next = TASK_SORT_MODES[(index + 1) % TASK_SORT_MODES.length] ?? 'recent';
    setSort(next);
    updateTaskWorkspaceState({ sort: next });
  }

  function toggleSearch() {
    const next = !searchOpen;
    setSearchOpen(next);

    if (!next) {
      setQuery('');
      updateTaskWorkspaceState({ query: '' });
    }
  }

  function handleScroll(y: number) {
    updateTaskWorkspaceState({
      scroll: {
        active: tab === 'active' ? y : getTaskWorkspaceState().scroll.active,
        'up-next': tab === 'up-next' ? y : getTaskWorkspaceState().scroll['up-next'],
      },
    });
  }

  function openTask(task: AgentTask) {
    setSelectedTaskId(task.id);
    updateTaskWorkspaceState({ selectedTaskId: task.id });

    if (!showSplit) {
      router.push({ pathname: '/task/[id]', params: { id: task.id } } as Href);
    }
  }

  async function addTask() {
    const raw = newTaskText.trim();

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

      setNewTaskText('');
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
              setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the task.');
            }
          })();
        },
      },
    ]);
  }

  const refreshControl = (
    <RefreshControl
      refreshing={isRefreshing}
      onRefresh={() => {
        void load(true);
      }}
      tintColor={colors.accent}
      colors={[colors.accent]}
      progressBackgroundColor={colors.surface}
    />
  );

  const header = (
    <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.headerRow}>
        <SidebarButton onPress={openSidebar} />

        <View style={styles.brand}>
          <Brand size={26} />
          <Text accessibilityRole="header" style={styles.brandName}>
            ORBIT
          </Text>
          <Text style={styles.brandCaption}>TASK WORKSPACE</Text>
        </View>

        <View style={styles.headerSpacer} />
      </View>

      <TaskWorkspaceControls
        tab={tab}
        sort={sort}
        query={query}
        searchOpen={searchOpen}
        onSelectTab={selectTab}
        onCycleSort={cycleSort}
        onToggleSearch={toggleSearch}
        onQueryChange={(value) => {
          setQuery(value);
          updateTaskWorkspaceState({ query: value });
        }}
      />

      <Text style={styles.summary}>
        {tab === 'active'
          ? `${activeCount} active · ${resolvedCount} resolved`
          : `${totalCount} ${totalCount === 1 ? 'task' : 'tasks'}`}
      </Text>

      {error ? (
        <View style={styles.errorWrap}>
          <FormError message={error} onDismiss={() => setError(null)} />
        </View>
      ) : null}

      {tab === 'up-next' ? (
        <View style={styles.addRow}>
          <TextInput
            value={newTaskText}
            onChangeText={setNewTaskText}
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
            disabled={isAdding || newTaskText.trim().length === 0}
            onPress={() => {
              void addTask();
            }}
            style={({ pressed }) => [
              styles.addButton,
              (isAdding || newTaskText.trim().length === 0) && styles.addDisabled,
              pressed && styles.pressed,
            ]}
          >
            {isAdding ? (
              <ActivityIndicator size="small" color={colors.onInverse} />
            ) : (
              <Ionicons name="add" size={22} color={colors.onInverse} />
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  const listContentStyle = [styles.listContent, { paddingBottom: spacing.xl + insets.bottom }];

  // Rows are rendered by the section component so its collapse state stays in one place.
  const activeList = (
    <SectionList
      ref={activeListRef}
      sections={activeSections}
      keyExtractor={(item) => item.id}
      contentContainerStyle={listContentStyle}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
      onScroll={(event) => handleScroll(event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={100}
      renderSectionHeader={({ section }) => (
        <TaskGroupSection
          group={section}
          expanded={section.collapsible ? resolvedExpanded : true}
          selectedTaskId={showSplit ? selectedTaskId : null}
          onToggle={() => {
            const next = !resolvedExpanded;
            setResolvedExpanded(next);
            updateTaskWorkspaceState({ resolvedExpanded: next });
          }}
          onOpenTask={openTask}
        />
      )}
      renderItem={() => null}
      ListEmptyComponent={
        !isLoaded ? (
          <View style={styles.skeletonList}>
            <Skeleton height={64} radius={radius.md} />
            <Skeleton height={64} radius={radius.md} />
            <Skeleton height={64} radius={radius.md} />
          </View>
        ) : (
          <EmptyState
            icon="checkmark-done-circle-outline"
            title="Nothing here yet"
            message={query ? 'No agent tasks match your search.' : 'Agent work will appear here as Orbit runs tasks.'}
          />
        )
      }
    />
  );

  const personalList = (
    <SectionList
      ref={personalListRef}
      sections={personalSections}
      keyExtractor={(item) => String(item.id)}
      contentContainerStyle={listContentStyle}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={refreshControl}
      onScroll={(event) => handleScroll(event.nativeEvent.contentOffset.y)}
      scrollEventThrottle={100}
      renderSectionHeader={({ section }) =>
        section.collapsible ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Resolved, ${section.data.length} tasks. ${
              personalResolvedExpanded ? 'Collapse' : 'Expand'
            }`}
            accessibilityState={{ expanded: personalResolvedExpanded }}
            onPress={() => {
              const next = !personalResolvedExpanded;
              setPersonalResolvedExpanded(next);
              updateTaskWorkspaceState({ resolvedExpanded: next });
            }}
            style={({ pressed }) => [styles.personalSectionHeader, pressed && styles.pressed]}
          >
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Resolved
            </Text>
            <View style={styles.count}>
              <Text style={styles.countText}>{section.data.length}</Text>
            </View>
            <Text style={styles.chevron}>{personalResolvedExpanded ? '⌄' : '›'}</Text>
          </Pressable>
        ) : (
          <Text accessibilityRole="header" style={[styles.sectionTitle, styles.sectionHeaderSpacing]}>
            {section.title}
          </Text>
        )
      }
      renderItem={({ item, section }) =>
        section.collapsible && !personalResolvedExpanded ? null : (
          <TaskItem task={item} onToggle={toggleTask} onLongPress={confirmDelete} />
        )
      }
      ListEmptyComponent={
        !isLoaded ? (
          <View style={styles.skeletonList}>
            <Skeleton height={64} radius={radius.md} />
            <Skeleton height={64} radius={radius.md} />
          </View>
        ) : (
          <EmptyState
            icon="checkmark-done-circle-outline"
            title={query ? 'No matching tasks' : 'All clear'}
            message={query ? 'Try a different search.' : 'Add a task above, or ask Orbit to create one.'}
          />
        )
      }
      ListFooterComponent={
        personalTasks.length > 0 ? (
          <Text style={styles.footerHint}>Long-press a task to delete it.</Text>
        ) : undefined
      }
    />
  );

  const list = tab === 'active' ? activeList : personalList;

  if (showSplit) {
    return (
      <View style={styles.root}>
        <GlassBackdrop />
        <View style={styles.split}>
          <View style={styles.splitList}>{header}{list}</View>
          <View style={styles.splitDetail}>
            {selectedTaskId ? (
              <TaskDetail
                key={selectedTaskId}
                taskId={selectedTaskId}
                embedded
                onBack={() => {
                  setSelectedTaskId(null);
                  updateTaskWorkspaceState({ selectedTaskId: null });
                }}
              />
            ) : (
              <View style={styles.detailPlaceholder}>
                <Ionicons name="document-text-outline" size={30} color={colors.textFaint} />
                <Text style={styles.detailPlaceholderTitle}>Select a task</Text>
                <Text style={styles.detailPlaceholderText}>
                  Its conversation and recorded output will appear here.
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <GlassBackdrop />
      {header}
      {list}
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    header: {
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      backgroundColor: colors.background,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: 44,
    },
    headerSpacer: {
      width: 44,
    },
    brand: {
      flex: 1,
      alignItems: 'center',
      gap: 1,
    },
    brandName: {
      color: colors.text,
      fontFamily: fonts.serif,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 2.4,
    },
    brandCaption: {
      color: colors.textFaint,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 1.3,
    },
    summary: {
      color: colors.textMuted,
      fontSize: 12,
    },
    errorWrap: {
      marginTop: 2,
    },
    addRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    addInput: {
      flex: 1,
      minHeight: 46,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      color: colors.text,
      fontSize: 14,
    },
    addButton: {
      width: 46,
      height: 46,
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.inverse,
    },
    addDisabled: {
      opacity: 0.42,
    },
    pressed: {
      opacity: 0.7,
    },
    listContent: {
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.md,
    },
    skeletonList: {
      gap: spacing.sm,
      paddingTop: spacing.sm,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
    },
    sectionHeaderSpacing: {
      paddingHorizontal: spacing.xs,
      paddingVertical: 8,
    },
    personalSectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 34,
      paddingHorizontal: spacing.xs,
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
    footerHint: {
      color: colors.textFaint,
      fontSize: 11,
      textAlign: 'center',
      paddingVertical: spacing.md,
    },
    split: {
      flex: 1,
      flexDirection: 'row',
    },
    splitList: {
      width: '42%',
      maxWidth: 460,
      minWidth: 300,
    },
    splitDetail: {
      flex: 1,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.border,
    },
    detailPlaceholder: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      padding: spacing.lg,
      backgroundColor: colors.background,
    },
    detailPlaceholderTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    detailPlaceholderText: {
      color: colors.textMuted,
      fontSize: 13,
      textAlign: 'center',
    },
  });
