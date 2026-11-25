import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { StatusPill } from '@/components/StatusPill';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { artifactTypeLabel, ArtifactStore, type ArtifactSummary } from '@/lib/artifacts';
import { getChatStore, type Conversation } from '@/lib/chat';
import { MASTER_AGENT } from '@/lib/permissions';
import { listTasks, type Task } from '@/lib/tasks';
import { WorkflowStore, type WorkflowRun } from '@/lib/workflows';
import { fonts, layout, radius, spacing, typography } from '@/theme';

type ProjectFile = {
  key: string;
  name: string;
  conversationId: number;
  kind: 'image' | 'document';
};

type ResultRow = {
  id: string;
  title: string;
  detail: string;
  href: Href;
  icon: keyof typeof Ionicons.glyphMap;
};

function conversationLink(conversationId: number, params: Record<string, string | number> = {}): Href {
  const query = Object.entries(params)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');

  return `/chat?c=${conversationId}${query ? `&${query}` : `&t=${Date.now()}`}` as Href;
}

function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

type WorkspaceRowProps = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  detail: string;
  badge?: string;
  onPress: () => void;
};

function WorkspaceRow({ icon, title, detail, badge, onPress }: WorkspaceRowProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={colors.accent} />
      </View>
      <View style={styles.rowText}>
        <Text numberOfLines={1} style={styles.rowTitle}>
          {title}
        </Text>
        <Text numberOfLines={1} style={styles.rowDetail}>
          {detail}
        </Text>
      </View>
      {badge ? <Text style={styles.rowBadge}>{badge}</Text> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

export default function ProjectsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const { open } = useSidebar();
  const { user } = useSession();
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [files, setFiles] = useState<ProjectFile[]>([]);

  const load = useCallback(async () => {
    if (!user) {
      return;
    }

    setRefreshing(true);
    setError(null);

    try {
      const chat = getChatStore(db);
      const [nextConversations, nextTasks, nextArtifacts, nextRuns] = await Promise.all([
        chat.listConversations(user.id, 20, MASTER_AGENT.id),
        listTasks(db, user.id, { status: 'all', limit: 20 }),
        new ArtifactStore(db).list(user.id, 30),
        new WorkflowStore(db).listRuns(user.id, 20),
      ]);

      const messageLists = await Promise.all(
        nextConversations.slice(0, 8).map((conversation) =>
          chat.listMessages(user.id, conversation.id, 40).catch(() => [])
        )
      );
      const seen = new Set<string>();
      const nextFiles: ProjectFile[] = [];

      messageLists.forEach((messages, index) => {
        const conversationId = nextConversations[index].id;

        messages.forEach((message) => {
          (message.attachments ?? []).forEach((attachment) => {
            const key = `${conversationId}:${attachment.name}`;

            if (!seen.has(key)) {
              seen.add(key);
              nextFiles.push({
                key,
                name: attachment.name,
                conversationId,
                kind: attachment.kind,
              });
            }
          });
        });
      });

      setConversations(nextConversations);
      setTasks(nextTasks);
      setArtifacts(nextArtifacts);
      setRuns(nextRuns);
      setFiles(nextFiles.slice(0, 10));
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'The workspace could not be loaded.'
      );
    } finally {
      setRefreshing(false);
    }
  }, [db, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const openTasks = tasks.filter((task) => task.status === 'open').length;
  const results: ResultRow[] = [
    ...artifacts.slice(0, 4).map((artifact) => ({
      id: `artifact-${artifact.id}`,
      title: artifact.title,
      detail: `${artifactTypeLabel(artifact.type)} · updated ${shortDate(artifact.updatedAt)}`,
      href: `/artifact?id=${encodeURIComponent(artifact.id)}` as Href,
      icon: 'document-outline' as const,
    })),
    ...runs
      .filter((run) => run.conversationId !== null)
      .slice(0, 4)
      .map((run) => ({
        id: `run-${run.id}`,
        title: run.workflowName,
        detail: `${run.status} · ${shortDate(run.startedAt)} · ${run.summary.slice(0, 80)}`,
        href: conversationLink(run.conversationId as number),
        icon: 'flash-outline' as const,
      })),
  ];
  const isEmpty =
    !error &&
    conversations.length === 0 &&
    tasks.length === 0 &&
    artifacts.length === 0 &&
    runs.length === 0 &&
    files.length === 0;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + spacing.xl }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load()} tintColor={colors.accent} />
        }
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="WORKSPACE"
          title="Projects"
          subtitle="Chats, files, tasks and research results in one place."
          left={<SidebarButton onPress={open} />}
        />

        <View style={styles.projectCard}>
          <View style={styles.projectHeading}>
            <View style={styles.projectIcon}>
              <Ionicons name="briefcase" size={22} color={colors.onInverse} />
            </View>
            <View style={styles.projectText}>
              <Text style={styles.projectName}>Orbit workspace</Text>
              <Text style={styles.projectScope}>Scope used for agent tools and approvals</Text>
            </View>
            <StatusPill label="Active" tone="accent" showDot />
          </View>

          <View style={styles.counts}>
            <View style={styles.count}>
              <Text style={styles.countValue}>{conversations.length}</Text>
              <Text style={styles.countLabel}>Chats</Text>
            </View>
            <View style={styles.count}>
              <Text style={styles.countValue}>{openTasks}</Text>
              <Text style={styles.countLabel}>Open tasks</Text>
            </View>
            <View style={styles.count}>
              <Text style={styles.countValue}>{artifacts.length}</Text>
              <Text style={styles.countLabel}>Files</Text>
            </View>
            <View style={styles.count}>
              <Text style={styles.countValue}>{runs.length}</Text>
              <Text style={styles.countLabel}>Runs</Text>
            </View>
          </View>

          <View style={styles.quickActions}>
            <Button
              label="Open workspace chat"
              onPress={() => router.navigate(`/chat?n=1&t=${Date.now()}` as Href)}
            />
            <Button
              label="Agent activity"
              variant="secondary"
              onPress={() => router.navigate('/permissions?tab=activity' as Href)}
            />
          </View>
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isEmpty ? (
          <EmptyState
            icon="briefcase-outline"
            title="Your workspace is ready"
            message="Start a chat, create a task, or ask the agent to research something. Real results will collect here."
            actionLabel="Start a chat"
            onAction={() => router.navigate(`/chat?n=1&t=${Date.now()}` as Href)}
          />
        ) : null}

        {conversations.length > 0 ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Conversations
            </Text>
            {conversations.slice(0, 5).map((conversation) => (
              <WorkspaceRow
                key={conversation.id}
                icon="chatbubble-outline"
                title={conversation.title}
                detail={`${conversation.messageCount} messages · ${shortDate(conversation.updatedAt)}`}
                onPress={() => router.navigate(conversationLink(conversation.id))}
              />
            ))}
            <Pressable
              accessibilityRole="button"
              onPress={() => router.navigate('/conversations' as Href)}
              style={({ pressed }) => [styles.seeAll, pressed && styles.rowPressed]}
            >
              <Text style={styles.seeAllText}>All conversations</Text>
            </Pressable>
          </View>
        ) : null}

        {tasks.length > 0 ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Tasks
            </Text>
            {tasks.slice(0, 4).map((task) => (
              <WorkspaceRow
                key={task.id}
                icon={task.status === 'done' ? 'checkmark-circle-outline' : 'checkbox-outline'}
                title={task.title}
                detail={task.notes ?? (task.dueAt ? `Due ${shortDate(task.dueAt)}` : 'No due date')}
                badge={task.status === 'done' ? 'Done' : undefined}
                onPress={() => router.navigate('/tasks')}
              />
            ))}
          </View>
        ) : null}

        {files.length > 0 ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Files & attachments
            </Text>
            {files.slice(0, 6).map((file) => (
              <WorkspaceRow
                key={file.key}
                icon={file.kind === 'image' ? 'image-outline' : 'document-text-outline'}
                title={file.name}
                detail={file.kind === 'image' ? 'Image shared in chat' : 'Document shared in chat'}
                onPress={() => router.navigate(conversationLink(file.conversationId))}
              />
            ))}
          </View>
        ) : null}

        {results.length > 0 ? (
          <View style={styles.section}>
            <Text accessibilityRole="header" style={styles.sectionTitle}>
              Research & results
            </Text>
            {results.map((result) => (
              <WorkspaceRow
                key={result.id}
                icon={result.icon}
                title={result.title}
                detail={result.detail}
                onPress={() => router.navigate(result.href)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: layout.gutter,
      paddingTop: spacing.md,
      gap: spacing.lg,
    },
    projectCard: {
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.lg,
      padding: spacing.lg,
      gap: spacing.lg,
    },
    projectHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    projectIcon: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    projectText: {
      flex: 1,
      gap: 4,
    },
    projectName: {
      color: colors.text,
      fontFamily: fonts.serif,
      ...typography.section,
    },
    projectScope: {
      color: colors.textMuted,
      ...typography.caption,
    },
    counts: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    count: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    countValue: {
      color: colors.text,
      ...typography.title,
    },
    countLabel: {
      color: colors.textMuted,
      ...typography.caption,
    },
    quickActions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    error: {
      color: colors.danger,
      ...typography.bodySmall,
    },
    section: {
      gap: 2,
    },
    sectionTitle: {
      color: colors.text,
      fontFamily: fonts.serif,
      ...typography.section,
      marginBottom: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: layout.touchTarget + 4,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      paddingVertical: spacing.sm,
    },
    rowPressed: {
      opacity: 0.75,
    },
    rowIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowTitle: {
      color: colors.text,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    rowDetail: {
      color: colors.textMuted,
      ...typography.caption,
    },
    rowBadge: {
      color: colors.accent,
      ...typography.caption,
      fontWeight: '700',
    },
    seeAll: {
      minHeight: layout.touchTarget,
      alignItems: 'flex-start',
      justifyContent: 'center',
    },
    seeAllText: {
      color: colors.accent,
      ...typography.bodySmall,
      fontWeight: '600',
    },
  });
