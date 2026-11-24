import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
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
import { getChatStore } from '@/lib/chat';
import { BUILT_IN_AGENTS, listDynamicAgents } from '@/lib/permissions/agents';
import type { AgentIdentity } from '@/lib/permissions';
import { radius, spacing } from '@/theme';

type AgentRow = {
  agent: AgentIdentity;
  conversations: number;
  sharp: boolean;
};

function agentIcon(icon: string): keyof typeof Ionicons.glyphMap {
  return icon in Ionicons.glyphMap
    ? (icon as keyof typeof Ionicons.glyphMap)
    : 'sparkles-outline';
}

export default function AgentsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const db = useSQLiteContext();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const [dynamicAgents, setDynamicAgents] = useState<AgentIdentity[]>([]);
  const [conversationCounts, setConversationCounts] = useState<Record<string, number>>({});
  const [sharpAgents, setSharpAgents] = useState<Set<string>>(new Set());
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
          const [dynamic, conversations, configs] = await Promise.all([
            listDynamicAgents(db, user.id),
            getChatStore(db).listConversations(user.id, 500),
            import('@/lib/agent-settings').then(({ listAgentConfigs }) =>
              listAgentConfigs(db, user.id)
            ),
          ]);

          if (!active) {
            return;
          }

          const counts: Record<string, number> = {};
          const sharp = new Set<string>();

          for (const conversation of conversations) {
            const id = conversation.agentId ?? 'master';
            counts[id] = (counts[id] ?? 0) + 1;
          }

          for (const config of configs) {
            if (config.instructions.trim() || config.memory.trim()) {
              sharp.add(config.agentId);
            }
          }

          setDynamicAgents(dynamic);
          setConversationCounts(counts);
          setSharpAgents(sharp);
          setError(null);
        } catch (loadError) {
          if (active) {
            setError(
              loadError instanceof Error ? loadError.message : 'Could not load your agents.'
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

  const rows = useMemo<AgentRow[]>(() => {
    const all = [...BUILT_IN_AGENTS, ...dynamicAgents];
    const term = query.trim().toLowerCase();

    return all
      .filter(
        (agent) =>
          !term ||
          agent.name.toLowerCase().includes(term) ||
          agent.description.toLowerCase().includes(term)
      )
      .map((agent) => ({
        agent,
        conversations: conversationCounts[agent.id] ?? 0,
        sharp: sharpAgents.has(agent.id),
      }));
  }, [conversationCounts, dynamicAgents, query, sharpAgents]);

  if (!user) {
    return null;
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
          eyebrow="Orbit team"
          title="AI agents"
          subtitle="Each agent has its own chats, tools and memory. Access is never shared unless you allow it."
          left={<SidebarButton onPress={openSidebar} />}
        />

        <FormError message={error} onDismiss={() => setError(null)} />

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search agents"
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="Search agents"
          style={styles.search}
        />

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>Loading agents…</Text>
          </View>
        ) : rows.length === 0 ? (
          <EmptyState
            icon="search-outline"
            title="No agents found"
            message="Try a different name or clear the search."
            actionLabel="Clear search"
            onAction={() => setQuery('')}
          />
        ) : (
          <View style={styles.list}>
            {rows.map(({ agent, conversations, sharp }) => (
              <GlassView
                key={agent.id}
                onPress={() =>
                  router.push(`/agents/${encodeURIComponent(agent.id)}` as Href)
                }
                accessibilityLabel={`Open ${agent.name}`}
                style={styles.card}
              >
                <View style={styles.cardTop}>
                  <View style={styles.iconWrap}>
                    <Ionicons name={agentIcon(agent.icon)} size={23} color={colors.accent} />
                  </View>
                  <View style={styles.cardCopy}>
                    <Text style={styles.name}>{agent.name}</Text>
                    <Text style={styles.description} numberOfLines={2}>
                      {agent.description}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={19} color={colors.textFaint} />
                </View>
                <View style={styles.cardFooter}>
                  <Text style={styles.role}>{agent.role}</Text>
                  <Text style={styles.meta}>
                    {conversations} chat{conversations === 1 ? '' : 's'}
                  </Text>
                  {sharp ? <Text style={styles.sharp}>Customized</Text> : null}
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Manage ${agent.name} tools`}
                  onPress={() =>
                    router.push(`/agents/${encodeURIComponent(agent.id)}/tools` as Href)
                  }
                  style={styles.toolLink}
                >
                  <Ionicons name="options-outline" size={15} color={colors.accent} />
                  <Text style={styles.toolLinkText}>Tools & memory</Text>
                </Pressable>
              </GlassView>
            ))}
          </View>
        )}

        <Text style={styles.note}>
          New agents start with no grants. Every sensitive tool call still asks for approval.
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
      gap: spacing.md,
    },
    card: {
      padding: spacing.md,
      gap: spacing.md,
    },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    iconWrap: {
      width: 46,
      height: 46,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardCopy: {
      flex: 1,
      gap: 3,
    },
    name: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    description: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    cardFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    role: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
    },
    meta: {
      color: colors.textFaint,
      fontSize: 12,
    },
    sharp: {
      color: colors.success,
      fontSize: 12,
      fontWeight: '600',
    },
    toolLink: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: spacing.xs,
    },
    toolLinkText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '600',
    },
    note: {
      color: colors.textFaint,
      fontSize: 12,
      lineHeight: 18,
      textAlign: 'center',
      paddingBottom: spacing.md,
    },
  });
