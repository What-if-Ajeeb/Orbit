import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand } from '@/components/Brand';
import { TaskItem } from '@/components/TaskItem';
import { useSession } from '@/context/auth';
import { isAiConfigured, loadAiSettings } from '@/lib/ai/settings';
import { completeTask, getTaskStats, listTasks, reopenTask, type Task, type TaskStats } from '@/lib/tasks';
import { colors, radius, spacing } from '@/theme';

function getGreeting(): string {
  const hour = new Date().getHours();

  if (hour < 12) {
    return 'Good morning';
  }

  if (hour < 17) {
    return 'Good afternoon';
  }

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

function StatCard({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={[styles.statValue, { color: tone }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [stats, setStats] = useState<TaskStats | null>(null);
  const [aiReady, setAiReady] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      return;
    }

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

  if (!user) {
    return null;
  }

  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  const initials = getInitials(user.name);

  async function toggleTask(task: Task) {
    if (!user) {
      return;
    }

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
      <View pointerEvents="none" style={styles.glow} />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <Brand size={38} />
            <Text style={styles.wordmark}>ORBIT</Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open settings"
            onPress={() => router.push('/settings')}
            style={styles.avatar}
          >
            <Text style={styles.avatarText}>{initials || 'O'}</Text>
          </Pressable>
        </View>

        <Text style={styles.greeting}>
          {getGreeting()}, {firstName}
        </Text>
        <Text style={styles.subGreeting}>Aaj kya karna hai?</Text>

        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <Ionicons name="sparkles" size={18} color={colors.accent} />
            </View>
            <Text style={styles.heroTitle}>Orbit Agent</Text>
            <View style={[styles.statusChip, aiReady ? styles.statusOn : styles.statusOff]}>
              <Text style={[styles.statusChipText, { color: aiReady ? colors.success : colors.textMuted }]}>
                {aiReady ? 'AI READY' : 'LOCAL MODE'}
              </Text>
            </View>
          </View>

          <Text style={styles.heroText}>
            Tasks bolo, reminders set karo, pending check karo. Sab kuch is device par rehta hai.
          </Text>

          <Text style={styles.heroExample}>“Remind me to call mom at 7pm”</Text>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/chat')}
            style={({ pressed }) => [styles.heroButton, pressed && styles.pressed]}
          >
            <Text style={styles.heroButtonText}>Open agent</Text>
            <Ionicons name="arrow-forward" size={17} color={colors.white} />
          </Pressable>

          {!aiReady ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.heroHint, pressed && styles.pressed]}
            >
              <Ionicons name="key-outline" size={13} color={colors.accent} />
              <Text style={styles.heroHintText}>AI key add karo for full chat</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.statsRow}>
          <StatCard value={stats?.openCount ?? 0} label="Open" tone={colors.text} />
          <StatCard value={stats?.dueToday ?? 0} label="Due today" tone={colors.accent} />
          <StatCard value={stats?.doneCount ?? 0} label="Done" tone={colors.success} />
        </View>

        <View style={styles.sectionRow}>
          <Text style={styles.sectionLabel}>NEXT UP</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push('/tasks')} hitSlop={8}>
            <Text style={styles.link}>View all</Text>
          </Pressable>
        </View>

        <View style={styles.list}>
          {tasks.length > 0 ? (
            tasks.map((task) => (
              <TaskItem key={task.id} task={task} onToggle={toggleTask} />
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="checkmark-done-circle-outline" size={26} color={colors.success} />
              <View style={styles.emptyText}>
                <Text style={styles.emptyTitle}>All clear</Text>
                <Text style={styles.emptySubtitle}>
                  Koi open task nahi hai. Agent se naya task add karwao.
                </Text>
              </View>
            </View>
          )}
        </View>

        <Text style={styles.footer}>
          Orbit v{Constants.expoConfig?.version ?? '1.1.1'} · local-first · Android
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
  },
  glow: {
    position: 'absolute',
    top: -180,
    right: -120,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: colors.accentSoft,
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
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 4,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  greeting: {
    color: colors.text,
    fontSize: 29,
    fontWeight: '700',
    letterSpacing: -0.6,
    marginTop: spacing.xl,
  },
  subGreeting: {
    color: colors.textMuted,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  hero: {
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: 'rgba(109, 139, 255, 0.3)',
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  heroIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  statusChip: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  statusOn: {
    backgroundColor: colors.successSoft,
  },
  statusOff: {
    backgroundColor: colors.surfaceAlt,
  },
  statusChipText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  heroText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 2,
  },
  heroExample: {
    color: colors.textFaint,
    fontSize: 13,
    fontStyle: 'italic',
  },
  heroButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentStrong,
    borderRadius: radius.md,
    minHeight: 48,
    marginTop: spacing.xs,
  },
  heroButtonText: {
    color: colors.white,
    fontSize: 15,
    fontWeight: '600',
  },
  heroHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingTop: 2,
  },
  heroHintText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.8,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  statLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.6,
    marginTop: 2,
    textTransform: 'uppercase',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
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
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
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
  footer: {
    color: colors.textFaint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
