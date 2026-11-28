import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AgentChatView, type TaskDetailHeaderInfo } from '@/components/AgentChatView';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { getAgentTask } from '@/lib/agent-runtime/task-manager';
import type { AgentTask } from '@/lib/agent-runtime/types';
import { MASTER_AGENT, getAgentIdentity, listDynamicAgents } from '@/lib/permissions/agents';
import type { AgentIdentity } from '@/lib/permissions/types';
import {
  TASK_GROUP_META,
  groupForStatus,
  statusLabel,
} from '@/lib/task-workspace';
import { radius, spacing } from '@/theme';

type Props = {
  taskId: string;
  onBack?: () => void;
  embedded?: boolean;
};

export function TaskDetail({ taskId, onBack, embedded = false }: Props) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const { user } = useSession();
  const [task, setTask] = useState<AgentTask | null>(null);
  const [agent, setAgent] = useState<AgentIdentity>(MASTER_AGENT);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const found = await getAgentTask(db, taskId);
        const owned = found && found.userId === user.id ? found : null;

        if (!active) {
          return;
        }

        setTask(owned);

        if (owned) {
          const dynamic = await listDynamicAgents(db, user.id);
          const resolved =
            getAgentIdentity(owned.subagentId ?? 'master') ??
            dynamic.find((item) => item.id === owned.subagentId) ??
            MASTER_AGENT;

          if (active) {
            setAgent(resolved);
          }
        }
      } catch {
        if (active) {
          setTask(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [db, taskId, user]);

  const detail = useMemo<TaskDetailHeaderInfo | null>(() => {
    if (!task) {
      return null;
    }

    const groupLabel = TASK_GROUP_META[groupForStatus(task.status)].title;
    const stateLabel = statusLabel(task.status);

    return {
      title: task.title,
      status: groupLabel === stateLabel ? groupLabel : `${groupLabel} · ${stateLabel}`,
      conversationId: task.conversationId,
      task,
      onBack,
    };
  }, [onBack, task]);

  if (loading) {
    return (
      <View accessibilityRole="progressbar" style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.emptyText}>Loading task…</Text>
      </View>
    );
  }

  if (!task || !detail) {
    return (
      <View style={styles.centered}>
        <Ionicons name="document-text-outline" size={28} color={colors.textFaint} />
        <Text accessibilityRole="header" style={styles.emptyTitle}>
          Task not found
        </Text>
        <Text style={styles.emptyText}>
          This task is unavailable or belongs to a different account.
        </Text>
        {!embedded ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to tasks"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Text style={styles.backText}>Back to tasks</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <AgentChatView
        agent={agent}
        agentId={agent.id}
        detail={detail}
        showAddMenu
      />
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      padding: spacing.lg,
      backgroundColor: colors.background,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 13,
      textAlign: 'center',
    },
    backButton: {
      marginTop: spacing.sm,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
    },
    pressed: {
      opacity: 0.72,
    },
    backText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
  });
