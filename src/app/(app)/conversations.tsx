import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmptyState } from '@/components/EmptyState';
import { FormError } from '@/components/FormError';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { getChatStore, type Conversation } from '@/lib/chat';
import { resolveAgentIdentity } from '@/lib/permissions/agents';
import type { AgentIdentity } from '@/lib/permissions';
import { radius, spacing } from '@/theme';

function conversationHref(conversation: Conversation): Href {
  const agentId = conversation.agentId ?? 'master';

  return `/agents/${encodeURIComponent(agentId)}?c=${conversation.id}&t=${Date.now()}` as Href;
}

function formatDate(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toLocaleString();
  }
}

export default function ConversationsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const db = useSQLiteContext();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentIdentity>>({});
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        return;
      }

      let active = true;
      setLoading(true);

      void (async () => {
        try {
          const list = await getChatStore(db).listConversations(user.id, 300);
          const ids = Array.from(new Set(list.map((item) => item.agentId ?? 'master')));
          const resolved = await Promise.all(
            ids.map(async (id) => [id, await resolveAgentIdentity(db, user.id, id)] as const)
          );
          const names: Record<string, AgentIdentity> = {};

          for (const [id, identity] of resolved) {
            if (identity) {
              names[id] = identity;
            }
          }

          if (!active) {
            return;
          }

          setConversations(list);
          setAgents(names);
          setError(null);
        } catch (loadError) {
          if (active) {
            setError(
              loadError instanceof Error ? loadError.message : 'Could not load conversations.'
            );
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
    }, [db, user])
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();

    return [...conversations]
      .filter(
        (conversation) =>
          !term ||
          conversation.title.toLowerCase().includes(term) ||
          (conversation.agentId ?? 'master').toLowerCase().includes(term)
      )
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }, [conversations, query]);

  if (!user) {
    return null;
  }

  const activeUser = user;

  function open(conversation: Conversation) {
    router.push(conversationHref(conversation));
  }

  function confirmDelete(conversation: Conversation) {
    Alert.alert(
      'Delete chat?',
      `“${conversation.title}” and its messages will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await getChatStore(db).deleteConversation(activeUser.id, conversation.id);
                setConversations((current) =>
                  current.filter((item) => item.id !== conversation.id)
                );
              } catch (deleteError) {
                setError(
                  deleteError instanceof Error ? deleteError.message : 'Could not delete that chat.'
                );
              }
            })();
          },
        },
      ]
    );
  }

  return (
    <View style={styles.root}>
      <GlassBackdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="Conversation history"
          title="All chats"
          subtitle="Every conversation stays in local SQLite. Search across agents and open any thread."
          left={<SidebarButton onPress={openSidebar} />}
        />

        <FormError message={error} onDismiss={() => setError(null)} />

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search conversations"
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="Search conversations"
          style={styles.search}
        />

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>Loading chats…</Text>
          </View>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon="chatbubbles-outline"
            title={query ? 'No matching chats' : 'No conversations yet'}
            message={
              query
                ? 'Try another title or agent name.'
                : 'Start a chat with an agent and it will appear here.'
            }
            actionLabel={query ? 'Clear search' : undefined}
            onAction={query ? () => setQuery('') : undefined}
          />
        ) : (
          <View style={styles.list}>
            {filtered.map((conversation) => {
              const agentId = conversation.agentId ?? 'master';
              const identity = agents[agentId];

              return (
                <GlassView
                  key={conversation.id}
                  onPress={() => open(conversation)}
                  accessibilityLabel={`Open ${conversation.title}`}
                  style={styles.card}
                >
                  <View style={styles.cardTop}>
                    <View style={styles.iconWrap}>
                      <Ionicons
                        name={(identity?.icon as keyof typeof Ionicons.glyphMap) ?? 'chatbubble-outline'}
                        size={20}
                        color={colors.accent}
                      />
                    </View>
                    <View style={styles.cardCopy}>
                      <Text style={styles.title} numberOfLines={1}>
                        {conversation.title}
                      </Text>
                      <Text style={styles.meta} numberOfLines={1}>
                        {identity?.name ?? agentId}
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Delete ${conversation.title}`}
                      hitSlop={8}
                      onPress={() => confirmDelete(conversation)}
                      style={styles.deleteButton}
                    >
                      <Ionicons name="trash-outline" size={17} color={colors.textFaint} />
                    </Pressable>
                  </View>
                  <View style={styles.cardFooter}>
                    <Text style={styles.meta}>{conversation.messageCount} messages</Text>
                    <Text style={styles.meta}>{formatDate(conversation.updatedAt)}</Text>
                  </View>
                </GlassView>
              );
            })}
          </View>
        )}
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
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
    },
    search: {
      minHeight: 50,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.text,
      paddingHorizontal: spacing.md,
      fontSize: 15,
    },
    loading: {
      paddingVertical: spacing.xl,
      alignItems: 'center',
      gap: spacing.sm,
    },
    loadingText: {
      color: colors.textMuted,
      fontSize: 14,
    },
    list: {
      gap: spacing.sm,
    },
    card: {
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: radius.sm,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardCopy: {
      flex: 1,
      gap: 2,
    },
    title: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    meta: {
      color: colors.textFaint,
      fontSize: 12,
    },
    deleteButton: {
      width: 34,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
  });
