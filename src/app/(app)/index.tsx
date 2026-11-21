import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { SidebarButton } from '@/components/SidebarButton';
import { TaskItem } from '@/components/TaskItem';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { isAiConfigured, loadAiSettings } from '@/lib/ai/settings';
import { completeTask, getTaskStats, listTasks, reopenTask, type Task, type TaskStats } from '@/lib/tasks';
import { radius, spacing } from '@/theme';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

function QuickAction({
  icon,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
    >
      <View style={styles.quickActionIcon}>
        <Ionicons name={icon} size={18} color={colors.accent} />
      </View>
      <Text style={styles.quickActionLabel}>{label}</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [aiReady, setAiReady] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;

    try {
      const [nextTasks, nextStats, settings] = await Promise.all([
        listTasks(db, user.id, { status: 'open', limit: 5 }),
        getTaskStats(db, user.id),
        loadAiSettings(),
      ]);

      setTasks(nextTasks);
      setStats(nextStats);
      setAiReady(isAiConfigured(settings));
    } catch (loadError) {
      console.warn('Could not load the dashboard.', loadError);
    }
  }, [db, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!user) return null;

  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  const initials = getInitials(user.name);

  async function toggleTask(task: Task) {
    if (!user) return;

    try {
      if (task.status === 'done') {
        await reopenTask(db, user.id, task.id);
      } else {
        await completeTask(db, user.id, task.id);
      }
      await load();
    } catch (toggleError) {
      console.warn('Could not update the task.', toggleError);
    }
  }

  return (
    <View style={styles.root}>
      <GlassBackdrop />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <SidebarButton onPress={openSidebar} />
            <Text style={styles.wordmark}>ORBIT</Text>
          </View>

          <View style={styles.topRight}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Notifications"
              style={styles.iconBtn}
            >
              <Ionicons name="notifications-outline" size={20} color={colors.textMuted} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              onPress={() => router.push('/settings')}
              style={styles.avatar}
            >
              <Text style={styles.avatarText}>{initials || 'O'}</Text>
            </Pressable>
          </View>
        </View>

        {/* Greeting */}
        <Text style={styles.greeting}>
          Hello, {firstName} 👋
        </Text>
        <Text style={styles.subGreeting}>Your Personal Agent is ready.</Text>

        {/* Master Agent card */}
        <GlassView style={styles.agentCard}>
          <View style={styles.agentRow}>
            <View style={styles.agentAvatar}>
              <Ionicons name="hardware-chip" size={22} color={colors.accent} />
            </View>
            <View style={styles.agentInfo}>
              <Text style={styles.agentName}>Master Agent</Text>
              <View style={styles.statusRow}>
                <View style={[styles.statusDot, { backgroundColor: aiReady ? colors.success : colors.warning }]} />
                <Text style={styles.statusText}>
                  {aiReady ? 'Online · Personal AI' : 'Local mode'}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/chat')}
            style={({ pressed }) => [styles.promptField, pressed && styles.pressed]}
          >
            <Ionicons name="sparkles" size={16} color={colors.accent} />
            <Text style={styles.promptPlaceholder}>Tell ORBIT what you want to do…</Text>
            <Ionicons name="mic-outline" size={18} color={colors.textFaint} />
          </Pressable>
        </GlassView>

        {/* Quick actions */}
        <View style={styles.quickRow}>
          <QuickAction icon="construct-outline" label="Build" onPress={() => router.push('/chat')} />
          <QuickAction icon="search-outline" label="Research" onPress={() => router.push('/chat')} />
          <QuickAction icon="analytics-outline" label="Analyze" onPress={() => router.push('/chat')} />
          <QuickAction icon="flash-outline" label="Automate" onPress={() => router.push('/chat')} />
        </View>

        {/* Active Tasks */}
        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>
            Active Tasks{stats ? ` (${stats.openCount})` : ''}
          </Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/tasks')} hitSlop={8}>
            <Text style={styles.link}>View All</Text>
          </Pressable>
        </View>

        <View style={styles.list}>
          {tasks.length > 0 ? (
            tasks.map((task) => (
              <TaskItem key={task.id} task={task} onToggle={toggleTask} />
            ))
          ) : (
            <GlassView style={styles.emptyCard}>
              <Ionicons name="checkmark-done-circle-outline" size={26} color={colors.success} />
              <View style={styles.emptyText}>
                <Text style={styles.emptyTitle}>All clear</Text>
                <Text style={styles.emptySubtitle}>
                  No open tasks. Tell the agent what you need next.
                </Text>
              </View>
            </GlassView>
          )}
        </View>

        {/* Stats strip */}
        <View style={styles.statsRow}>
          <GlassView style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.text }]}>{stats?.openCount ?? 0}</Text>
            <Text style={styles.statLabel}>Open</Text>
          </GlassView>
          <GlassView style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.accent }]}>{stats?.dueToday ?? 0}</Text>
            <Text style={styles.statLabel}>Due today</Text>
          </GlassView>
          <GlassView style={styles.statCard}>
            <Text style={[styles.statValue, { color: colors.success }]}>{stats?.doneCount ?? 0}</Text>
            <Text style={styles.statLabel}>Done</Text>
          </GlassView>
        </View>

        <Text style={styles.footer}>
          Orbit v{Constants.expoConfig?.version ?? '1.8.0'} · local-first
        </Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      flexGrow: 1,
      paddingHorizontal: spacing.lg,
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    wordmark: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      letterSpacing: 3,
    },
    topRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    iconBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    avatar: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.accentSoft,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '700',
    },
    greeting: {
      color: colors.text,
      fontSize: 28,
      fontWeight: '700',
      letterSpacing: -0.5,
      marginTop: spacing.lg,
    },
    subGreeting: {
      color: colors.textMuted,
      fontSize: 15,
      marginTop: 4,
      marginBottom: spacing.md,
    },
    agentCard: {
      padding: spacing.md,
      gap: spacing.md,
    },
    agentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    agentAvatar: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    agentInfo: {
      flex: 1,
      gap: 2,
    },
    agentName: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    statusDot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    statusText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '500',
    },
    promptField: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surfaceAlt,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      minHeight: 48,
    },
    promptPlaceholder: {
      flex: 1,
      color: colors.textFaint,
      fontSize: 14,
    },
    quickRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    quickAction: {
      flex: 1,
      alignItems: 'center',
      gap: 6,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
    },
    quickActionIcon: {
      width: 36,
      height: 36,
      borderRadius: 12,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quickActionLabel: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.xl,
      marginBottom: spacing.sm,
    },
    sectionLabel: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    link: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '600',
    },
    list: {
      gap: spacing.sm,
    },
    emptyCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
    },
    emptyText: {
      flex: 1,
      gap: 2,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    emptySubtitle: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    statsRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    statCard: {
      flex: 1,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    statValue: {
      fontSize: 22,
      fontWeight: '700',
      letterSpacing: -0.4,
    },
    statLabel: {
      color: colors.textFaint,
      fontSize: 11,
      fontWeight: '600',
      letterSpacing: 0.4,
      marginTop: 2,
      textTransform: 'uppercase',
    },
    footer: {
      color: colors.textFaint,
      fontSize: 12,
      textAlign: 'center',
      marginTop: spacing.xl,
    },
    pressed: {
      opacity: 0.8,
    },
  });
