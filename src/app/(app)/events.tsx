import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { EventStore, type StoredEvent } from '@/lib/events';
import { radius, spacing } from '@/theme';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';

type Tone = 'accent' | 'success' | 'textMuted' | 'text' | 'warning';

const TYPE_META: Record<
  StoredEvent['type'],
  { icon: keyof typeof Ionicons.glyphMap; tone: Tone }
> = {
  turn_started: { icon: 'sparkles', tone: 'accent' },
  turn_ended: { icon: 'sparkles', tone: 'success' },
  step_started: { icon: 'construct', tone: 'accent' },
  step_ended: { icon: 'construct', tone: 'textMuted' },
  tool_call: { icon: 'construct-outline', tone: 'accent' },
  tool_result: { icon: 'checkmark-circle', tone: 'success' },
  message_added: { icon: 'chatbubble-outline', tone: 'text' },
  ai_request: { icon: 'send-outline', tone: 'accent' },
  ai_response: { icon: 'send', tone: 'success' },
  forked: { icon: 'git-compare', tone: 'warning' },
  resumed: { icon: 'play', tone: 'success' },
  paused: { icon: 'pause', tone: 'warning' },
};

function summaryText(event: StoredEvent): string {
  const p = event.payload;

  switch (event.type) {
    case 'tool_call':
      return `🛠 ${p.toolName}`;
    case 'tool_result':
      return `${p.durationMs ?? 0}ms · ${
        p.success ? 'ok' : p.error ?? 'failed'
      }`;
    case 'ai_request':
      return `~${p.tokensIn ?? 0} tokens · ${p.messageCount ?? 0} messages`;
    case 'ai_response':
      return `~${p.tokensOut ?? 0} tokens`;
    case 'forked':
      return `forked from #${p.sourceConversationId}`;
    case 'step_started':
      return `step ${p.round ?? 0}`;
    case 'step_ended':
      return `step ${p.round ?? 0} · ${p.toolCalls ?? 0} tools`;
    case 'turn_started':
      return `provider: ${p.provider ?? 'local'}`;
    case 'turn_ended':
      return p.failed ? 'failed' : p.partial ? 'partial' : 'ok';
    default:
      return Object.keys(p).join(', ') || '-';
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}:${date.getSeconds().toString().padStart(2, '0')}`;
}

export default function EventsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [forkNotice, setForkNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      setLoading(true);
      const store = new EventStore(db);

      const conversations = (await db.getAllAsync(
        `SELECT id FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`,
        user.id
      )) as { id: number }[];

      if (conversations.length === 0) {
        setEvents([]);
        setLoading(false);
        return;
      }

      const conversationId = conversations[0].id;
      const next = await store.listEvents(user.id, conversationId, 200);
      setEvents(next);
    } catch (loadError) {
      console.warn('Could not load events.', loadError);
    } finally {
      setLoading(false);
    }
  }, [db, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function forkConversation() {
    if (!user) {
      return;
    }

    Alert.alert(
      'Fork conversation?',
      'Nayi conversation banayi jayegi jo iske saare events copy karegi.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Fork',
          style: 'destructive',
          onPress: async () => {
            try {
              const store = new EventStore(db);
              const conversations = (await db.getAllAsync(
                `SELECT id FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 1`,
                user.id
              )) as { id: number }[];

              if (conversations.length === 0) {
                return;
              }

              const sourceId = conversations[0].id;
              const newId = await store.forkConversation(
                user.id,
                sourceId,
                `Fork of #${sourceId}`
              );
              setForkNotice(
                `Fork created (conversation #${newId}). Open it from the Agent tab history.`
              );
              await load();
            } catch (forkError) {
              console.warn('Could not fork conversation.', forkError);
              setForkNotice('Could not fork the session. Please try again.');
            }
          },
        },
      ]
    );
  }

  if (!user) {
    return null;
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
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
        <ScreenHeader
          eyebrow="OBSERVABILITY"
          title="Event log"
          subtitle="Every turn, tool call and response is saved as an event."
          left={<SidebarButton onPress={openSidebar} />}
        />

        {forkNotice ? (
          <View style={styles.notice}>
            <Ionicons name="git-compare" size={15} color={colors.success} />
            <Text style={styles.noticeText}>{forkNotice}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={forkConversation}
          style={({ pressed }) => [
            styles.forkButton,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="git-compare" size={16} color={colors.white} />
          <Text style={styles.forkText}>Fork conversation</Text>
        </Pressable>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            {events.length} event{events.length !== 1 ? 's' : ''}
          </Text>

          {events.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="receipt-outline" size={32} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>No events yet</Text>
              <Text style={styles.emptyText}>
                Chat with the agent once and events will start appearing here.
              </Text>
            </View>
          ) : (
            <View style={styles.list}>
              {events.map((event) => {
                const meta = TYPE_META[event.type];

                return (
                  <View key={event.id} style={styles.eventRow}>
                    <View
                      style={[
                        styles.eventIcon,
                        { backgroundColor: colors[meta.tone] },
                      ]}
                    >
                      <Ionicons name={meta.icon} size={15} color={colors.white} />
                    </View>

                    <View style={styles.eventText}>
                      <View style={styles.eventNameRow}>
                        <Text
                          numberOfLines={1}
                          style={[
                            styles.eventName,
                            { color: colors[meta.tone] },
                          ]}
                        >
                          {event.type}
                        </Text>
                        <Text style={styles.eventTime}>
                          {formatTime(event.createdAt)}
                        </Text>
                      </View>
                      <Text numberOfLines={2} style={styles.eventSummary}>
                        {summaryText(event)}
                      </Text>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <Text style={styles.footer}>
          Events are append-only — none are ever edited or deleted.
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
  glow: {
    position: 'absolute',
    top: -170,
    right: -110,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.accentSoft,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: `${colors.success}47`,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  noticeText: {
    flex: 1,
    color: colors.success,
    fontSize: 13,
    lineHeight: 19,
  },
  forkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.accentSoft,
    marginVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  forkText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    marginTop: spacing.lg,
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginBottom: spacing.xs,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.xs,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 2,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  list: {
    gap: spacing.xs,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 3,
    paddingHorizontal: spacing.md,
  },
  eventIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventText: {
    flex: 1,
    gap: 2,
  },
  eventNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  eventName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  eventTime: {
    color: colors.textFaint,
    fontSize: 10,
  },
  eventSummary: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  footer: {
    color: colors.textFaint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  loading: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  pressed: {
    opacity: 0.78,
  },
});
