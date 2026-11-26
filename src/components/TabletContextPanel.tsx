import Ionicons from '@expo/vector-icons/Ionicons';
import { router, usePathname, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { chatLink } from '@/components/AppSidebar';
import { useSession } from '@/context/auth';
import { useTabletLayout } from '@/context/tablet-layout';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { formatDue } from '@/lib/dates';
import { permissionManager } from '@/lib/permissions';
import { completeTask, listTasks, type Task } from '@/lib/tasks';
import { fonts, layout, radius, spacing, typography } from '@/theme';

const MIN_PANEL_WIDTH = 280;
const MAX_PANEL_WIDTH = 480;
const TASK_LIMIT = 4;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function routeLabel(pathname: string): string {
  if (pathname.startsWith('/chat')) {
    return 'Chat';
  }

  if (pathname.startsWith('/projects')) {
    return 'Projects';
  }

  if (pathname.startsWith('/plugin') || pathname.startsWith('/plugins')) {
    return 'Plugins';
  }

  if (pathname.startsWith('/marketplace')) {
    return 'Marketplace';
  }

  if (pathname.startsWith('/buddy')) {
    return 'Buddy';
  }

  if (pathname.startsWith('/settings')) {
    return 'Settings';
  }

  if (pathname.startsWith('/tasks')) {
    return 'Tasks';
  }

  if (pathname === '/' || pathname === '/index') {
    return 'Today';
  }

  return 'ORBIT workspace';
}

/** Resizable task/context pane shown on large landscape tablets. */
export function TabletContextPanel() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const db = useSQLiteContext();
  const { user } = useSession();
  const pathname = usePathname();
  const { contextPanelWidth, setContextPanelWidth, setContextPanelOpen } = useTabletLayout();
  const [drag, setDrag] = useState<{ start: number; width: number } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const liveWidth = drag?.width ?? contextPanelWidth;
  const userId = user?.id;

  const subscribe = useCallback(
    (listener: () => void) => permissionManager.subscribe(listener),
    []
  );

  const getPendingCount = useCallback(
    () => (userId === undefined ? 0 : permissionManager.getPendingForUser(userId).length),
    [userId]
  );

  const pendingCount = useSyncExternalStore(subscribe, getPendingCount, () => 0);

  const refreshTasks = useCallback(async () => {
    if (userId === undefined) {
      setTasks([]);
      return;
    }

    try {
      setTasks(await listTasks(db, userId, { limit: TASK_LIMIT }));
    } catch (error) {
      console.warn('Could not load context tasks.', error);
    }
  }, [db, userId]);

  useEffect(() => {
    void (async () => {
      await refreshTasks();
    })();
  }, [pathname, refreshTasks]);

  const resizeResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          setDrag({ start: liveWidth, width: liveWidth });
        },
        onPanResponderMove: (_event, gesture) => {
          setDrag((current) => {
            if (!current) {
              return null;
            }

            return {
              ...current,
              width: clamp(current.start - gesture.dx, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH),
            };
          });
        },
        onPanResponderRelease: (_event, gesture) => {
          const start = drag?.start ?? liveWidth;
          setContextPanelWidth(clamp(start - gesture.dx, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH));
          setDrag(null);
        },
        onPanResponderTerminate: () => setDrag(null),
      }),
    [drag, liveWidth, setContextPanelWidth]
  );

  async function complete(task: Task) {
    if (userId === undefined) {
      return;
    }

    try {
      await completeTask(db, userId, task.id);
      await refreshTasks();
    } catch (error) {
      console.warn('Could not complete task from context panel.', error);
    }
  }

  return (
    <View
      style={[
        styles.panel,
        {
          width: liveWidth,
          paddingTop: insets.top,
          paddingBottom: Math.max(insets.bottom, spacing.md),
        },
      ]}
    >
      <View
        accessibilityRole="adjustable"
        accessibilityLabel="Resize context panel"
        accessibilityHint="Drag left or right to change the panel width"
        style={styles.resizeHandle}
        {...resizeResponder.panHandlers}
      >
        <View style={styles.resizeGrip} />
      </View>

      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>TABLET WORKSPACE</Text>
          <Text accessibilityRole="header" style={styles.title}>
            Context
          </Text>
          <Text numberOfLines={1} style={styles.subtitle}>
            {routeLabel(pathname)}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Collapse context panel"
          hitSlop={8}
          onPress={() => setContextPanelOpen(false)}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Start a new chat"
        onPress={() => router.navigate(chatLink({ n: 1 }))}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Ionicons name="add-circle-outline" size={18} color={colors.accent} />
        <Text style={styles.actionText}>New chat</Text>
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Chat history"
        onPress={() => router.navigate('/conversations' as Href)}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Ionicons name="time-outline" size={18} color={colors.accent} />
        <Text style={styles.actionText}>Chat history</Text>
        <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Approvals"
        onPress={() => router.navigate('/approvals' as Href)}
        style={({ pressed }) => [styles.action, pressed && styles.pressed]}
      >
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
        <Text style={styles.actionText}>Approvals</Text>
        {pendingCount > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{pendingCount > 9 ? '9+' : pendingCount}</Text>
          </View>
        ) : (
          <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
        )}
      </Pressable>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Open tasks</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open all tasks"
          onPress={() => router.navigate('/tasks' as Href)}
          style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
        >
          <Text style={styles.linkText}>View all</Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.taskScroll}
        contentContainerStyle={styles.taskContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {tasks.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="checkbox-outline" size={28} color={colors.textFaint} />
            <Text style={styles.emptyTitle}>Nothing open</Text>
            <Text style={styles.emptyText}>Tasks you add will appear here.</Text>
          </View>
        ) : (
          tasks.map((task) => (
            <View key={task.id} style={styles.taskRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Complete ${task.title}`}
                hitSlop={8}
                onPress={() => void complete(task)}
                style={styles.checkbox}
              >
                <Ionicons name="checkmark-outline" size={15} color={colors.accent} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open task ${task.title}`}
                onPress={() => router.navigate('/tasks' as Href)}
                style={({ pressed }) => [styles.taskText, pressed && styles.pressed]}
              >
                <Text numberOfLines={2} style={styles.taskTitle}>
                  {task.title}
                </Text>
                <Text numberOfLines={1} style={styles.taskDue}>
                  {formatDue(task.dueAt)}
                </Text>
              </Pressable>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    panel: {
      height: '100%',
      backgroundColor: colors.background,
      borderLeftWidth: StyleSheet.hairlineWidth,
      borderLeftColor: colors.border,
      paddingLeft: spacing.md,
    },
    resizeHandle: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: -6,
      width: 12,
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 2,
    },
    resizeGrip: {
      width: 3,
      height: 48,
      borderRadius: 2,
      backgroundColor: colors.accentSoft,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    headerText: {
      flex: 1,
      gap: 2,
    },
    eyebrow: {
      color: colors.accent,
      fontFamily: fonts.serif,
      ...typography.overline,
    },
    title: {
      color: colors.text,
      ...typography.section,
      fontWeight: '600',
    },
    subtitle: {
      color: colors.textFaint,
      ...typography.caption,
    },
    iconButton: {
      width: layout.iconButton,
      height: layout.iconButton,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: layout.touchTarget,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginTop: spacing.sm,
    },
    actionText: {
      flex: 1,
      color: colors.text,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    badge: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    badgeText: {
      color: colors.onInverse,
      fontSize: 11,
      fontWeight: '700',
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
    },
    sectionTitle: {
      color: colors.textMuted,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    linkButton: {
      minHeight: layout.touchTarget / 2,
      justifyContent: 'center',
    },
    linkText: {
      color: colors.accent,
      ...typography.caption,
      fontWeight: '600',
    },
    taskScroll: {
      flex: 1,
    },
    taskContent: {
      gap: spacing.xs,
      paddingBottom: spacing.md,
      flexGrow: 1,
    },
    taskRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: layout.touchTarget,
      paddingHorizontal: spacing.xs,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
    },
    checkbox: {
      width: 30,
      height: 30,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    taskText: {
      flex: 1,
      gap: 2,
    },
    taskTitle: {
      color: colors.text,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    taskDue: {
      color: colors.textFaint,
      ...typography.caption,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingVertical: spacing.xl,
    },
    emptyTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    emptyText: {
      color: colors.textFaint,
      ...typography.caption,
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.72,
    },
  });
