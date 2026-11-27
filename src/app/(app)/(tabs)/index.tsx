import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { SidebarButton } from '@/components/SidebarButton';
import { Skeleton } from '@/components/Skeleton';
import { TaskItem } from '@/components/TaskItem';
import { useSession } from '@/context/auth';
import { usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { isAiConfigured, loadAiSettings } from '@/lib/ai/settings';
import { completeTask, getTaskStats, listTasks, reopenTask, type Task, type TaskStats } from '@/lib/tasks';
import { fonts, layout, radius, spacing } from '@/theme';

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
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.quickAction, pressed && styles.pressed]}
    >
      <View style={styles.quickActionIcon}>
        <Ionicons name={icon} size={20} color={colors.accent} />
      </View>
      <Text style={styles.quickActionLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function StatCard({ value, label, color, loading }: { value: number; label: string; color: string; loading: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <GlassView style={styles.statCard}>
      {loading ? (
        <Skeleton width={36} height={26} radius={8} />
      ) : (
        <Text accessibilityLabel={`${value} ${label}`} style={[styles.statValue, { color }]}>
          {value}
        </Text>
      )}
      <Text style={styles.statLabel}>{label}</Text>
    </GlassView>
  );
}

export default function HomeScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const snapshot = usePluginSnapshot();
  const { open: openSidebar } = useSidebar();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [aiReady, setAiReady] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

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
    } finally {
      setIsLoaded(true);
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

  /** Opens the agent chat, optionally pre-filling the composer (the user still taps send). */
  function openChat(prompt?: string) {
    if (!prompt) {
      router.navigate('/chat');
      return;
    }

    router.navigate(`/chat?prompt=${encodeURIComponent(prompt)}&t=${Date.now()}` as Href);
  }

  async function refresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

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
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xl + insets.bottom },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              void refresh();
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <SidebarButton onPress={openSidebar} />
            <Text accessibilityRole="header" style={styles.wordmark}>
              Orbit
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open account details"
            onPress={() => router.navigate('/settings/account' as Href)}
            style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
          >
            <Text style={styles.avatarText}>{initials || 'O'}</Text>
          </Pressable>
        </View>

        {/* Greeting */}
        <Text accessibilityRole="header" style={styles.greeting}>
          {getGreeting()}, {firstName}
        </Text>
        <Text style={styles.subGreeting}>
          {stats && stats.dueToday > 0
            ? `You have ${stats.dueToday} task${stats.dueToday === 1 ? '' : 's'} due today.`
            : 'Your personal agent is ready.'}
        </Text>

        {/* Agent card */}
        <GlassView style={styles.agentCard}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open agent chat"
            onPress={() => openChat()}
            style={({ pressed }) => [styles.agentRow, pressed && styles.pressed]}
          >
            <View style={styles.agentAvatar}>
              <Ionicons name="hardware-chip" size={22} color={colors.accent} />
            </View>
            <View style={styles.agentInfo}>
              <Text style={styles.agentName}>Master Agent</Text>
              <View style={styles.statusRow}>
                <View
                  style={[styles.statusDot, { backgroundColor: aiReady ? colors.success : colors.warning }]}
                />
                <Text style={styles.statusText}>
                  {aiReady ? 'AI configured · Personal Agent' : 'Local mode · basic commands'}
                </Text>
              </View>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>

          {isLoaded && !aiReady ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Connect an AI provider in settings"
              onPress={() => router.navigate('/settings')}
              style={({ pressed }) => [styles.connectCta, pressed && styles.pressed]}
            >
              <Ionicons name="key-outline" size={16} color={colors.accent} />
              <Text style={styles.connectText}>Add an API key to unlock full AI chat</Text>
              <Ionicons name="arrow-forward" size={16} color={colors.accent} />
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Tell Orbit what you want to do"
              onPress={() => openChat()}
              style={({ pressed }) => [styles.promptField, pressed && styles.pressed]}
            >
              <Ionicons name="sparkles" size={16} color={colors.accent} />
              <Text style={styles.promptPlaceholder}>Tell Orbit what you want to do…</Text>
            </Pressable>
          )}
        </GlassView>

        {/* Quick actions: each one maps to something the agent really does */}
        <View style={styles.quickRow}>
          <QuickAction icon="add-circle-outline" label="Add task" onPress={() => openChat('Add task ')} />
          <QuickAction icon="alarm-outline" label="Remind me" onPress={() => openChat('Remind me to ')} />
          <QuickAction icon="list-outline" label="Pending" onPress={() => openChat("What's pending?")} />
          <QuickAction icon="checkbox-outline" label="All tasks" onPress={() => router.navigate('/tasks')} />
        </View>

        {/* Overview */}
        <View style={styles.statsRow}>
          <StatCard value={stats?.openCount ?? 0} label="Open" color={colors.text} loading={!isLoaded} />
          <StatCard value={stats?.dueToday ?? 0} label="Due today" color={colors.accent} loading={!isLoaded} />
          <StatCard value={stats?.doneCount ?? 0} label="Done" color={colors.success} loading={!isLoaded} />
        </View>

        {/* Plugin dashboard widgets: only running plugins with granted ui.contribute reach here. */}
        {snapshot.widgets.length > 0 ? (
          <View style={styles.pluginSection}>
            <View style={styles.sectionRow}>
              <Text accessibilityRole="header" style={styles.sectionLabel}>
                Plugin widgets
              </Text>
            </View>
            <View style={styles.pluginWidgetRow}>
              {snapshot.widgets.map((widget) => (
                <Pressable
                  key={`${widget.pluginId}:${widget.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${widget.title}`}
                  onPress={() =>
                    router.navigate(
                      `/plugin/${encodeURIComponent(widget.pluginId)}` as Href
                    )
                  }
                  style={({ pressed }) => [
                    styles.pluginWidget,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={styles.pluginWidgetTitle}>{widget.title}</Text>
                  <Text numberOfLines={3} style={styles.pluginWidgetBody}>
                    {widget.description}
                  </Text>
                  <Text numberOfLines={1} style={styles.pluginWidgetMeta}>
                    {widget.pluginName}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        {/* Up next */}
        <View style={styles.sectionRow}>
          <Text accessibilityRole="header" style={styles.sectionLabel}>
            Up next
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View all tasks"
            onPress={() => router.navigate('/tasks')}
            hitSlop={12}
          >
            <Text style={styles.link}>View all</Text>
          </Pressable>
        </View>

        <View style={styles.list}>
          {!isLoaded ? (
            <>
              <Skeleton height={64} radius={radius.md} />
              <Skeleton height={64} radius={radius.md} />
              <Skeleton height={64} radius={radius.md} />
            </>
          ) : tasks.length > 0 ? (
            tasks.map((task) => <TaskItem key={task.id} task={task} onToggle={toggleTask} />)
          ) : (
            <GlassView style={styles.emptyCard}>
              <Ionicons name="checkmark-done-circle-outline" size={28} color={colors.success} />
              <View style={styles.emptyText}>
                <Text style={styles.emptyTitle}>You&apos;re all caught up</Text>
                <Text style={styles.emptySubtitle}>
                  No open tasks. Tap “Add task” above or ask the agent.
                </Text>
              </View>
            </GlassView>
          )}
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
      width: '100%',
      maxWidth: layout.contentMaxWidth,
      alignSelf: 'center',
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
      fontFamily: fonts.serif,
      fontSize: 24,
      fontWeight: '600',
      letterSpacing: -0.2,
    },
    avatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    avatarText: {
      color: colors.onInverse,
      fontSize: 16,
      fontWeight: '700',
    },
    greeting: {
      color: colors.text,
      fontFamily: fonts.serif,
      fontSize: 32,
      fontWeight: '600',
      letterSpacing: -0.4,
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
      minHeight: 48,
    },
    connectCta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.accentSoft,
      borderRadius: radius.md,
      paddingHorizontal: 14,
      minHeight: 48,
    },
    connectText: {
      flex: 1,
      color: colors.accent,
      fontSize: 13,
      fontWeight: '600',
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
      color: colors.textMuted,
      fontSize: 14,
    },
    quickRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    quickAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 2,
      minHeight: 44,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    quickActionIcon: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    quickActionLabel: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    sectionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: spacing.lg,
      marginBottom: spacing.sm,
    },
    sectionLabel: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    link: {
      color: colors.accent,
      fontSize: 14,
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
      marginTop: spacing.md,
    },
    statCard: {
      flex: 1,
      paddingVertical: spacing.md,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 78,
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
    pluginSection: {
      gap: spacing.xs,
    },
    pluginWidgetRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    pluginWidget: {
      flexGrow: 1,
      flexBasis: '45%',
      minHeight: 96,
      padding: spacing.md,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      gap: 4,
    },
    pluginWidgetTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    pluginWidgetBody: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    pluginWidgetMeta: {
      color: colors.textFaint,
      fontSize: 10,
      marginTop: 'auto',
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
