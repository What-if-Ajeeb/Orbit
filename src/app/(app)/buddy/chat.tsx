import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BuddyAvatar } from '@/components/buddy/BuddyAvatar';
import { BuddyDetailHeader } from '@/components/buddy/BuddyDetailHeader';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { useRouteBuddy } from '@/hooks/useRouteBuddy';
import { requestBuddyCompletion } from '@/lib/ai/buddy-chat';
import { getForm, getSpecies, publishUserInteraction } from '@/lib/buddy';
import { radius, spacing } from '@/theme';

type ChatEntry = {
  id: string;
  role: 'user' | 'buddy';
  text: string;
  source?: 'ai' | 'local';
};

export default function BuddyChatScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const { user } = useSession();
  const { buddy, loading } = useRouteBuddy();
  const insets = useSafeAreaInsets();

  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const sendCountRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

  const species = buddy ? getSpecies(buddy.speciesId) : null;
  const form = buddy ? getForm(buddy.currentFormId) : null;
  const name = buddy?.nickname || form?.name || species?.name || 'Buddy';

  async function send() {
    const message = draft.trim();
    if (!buddy || !user || !message || busy) return;

    const occurrence = ++sendCountRef.current;
    const userEntry: ChatEntry = {
      id: `${buddy.id}:user:${Date.now()}:${occurrence}`,
      role: 'user',
      text: message,
    };
    setEntries((current) => [...current, userEntry]);
    setDraft('');
    setBusy(true);

    try {
      publishUserInteraction({
        userId: user.id,
        interaction: 'buddy_chat',
        surface: 'buddy_chat',
        occurrenceId: `${buddy.id}:${Date.now()}:${occurrence}`,
      });
      abortRef.current = new AbortController();
      const reply = await requestBuddyCompletion({
        buddy,
        message,
        signal: abortRef.current.signal,
      });
      setEntries((current) => [
        ...current,
        {
          id: `${buddy.id}:buddy:${Date.now()}:${occurrence}`,
          role: 'buddy',
          text: reply.text,
          source: reply.source,
        },
      ]);
    } catch (error) {
      console.warn('Buddy chat failed.', error);
    } finally {
      abortRef.current = null;
      setBusy(false);
    }
  }

  if (loading || !buddy) {
    return (
      <View style={[styles.root, styles.centered]}>
        <GlassBackdrop />
        <BuddyDetailHeader title="Buddy Chat" />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <GlassBackdrop />
      <BuddyDetailHeader title={`Chat with ${name}`} />

      <View style={styles.companion}>
        <BuddyAvatar
          speciesId={buddy.speciesId}
          formId={buddy.currentFormId}
          size={72}
          state={busy ? 'speaking' : 'idle'}
          interactive={false}
        />
        <View style={styles.companionCopy}>
          <Text style={styles.companionName}>{name}</Text>
          <Text style={styles.companionMeta}>
            {species?.mbti} · {species?.group} · Level {buddy.level}
          </Text>
          <Text style={styles.companionNote}>
            Only this chat may use AI. Buddy has no tools and cannot act for the Agent.
          </Text>
        </View>
      </View>

      <FlatList
        data={entries}
        keyExtractor={(item) => item.id}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <GlassView style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Say hello</Text>
            <Text style={styles.emptyText}>
              Ask about the day, talk through a decision, or just chat. Buddy stays in character.
            </Text>
          </GlassView>
        }
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.userBubble : styles.buddyBubble]}>
            <Text style={[styles.bubbleText, item.role === 'user' && styles.userText]}>{item.text}</Text>
            {item.source ? (
              <Text style={styles.sourceText}>{item.source === 'ai' ? 'AI reply' : 'Local reply'}</Text>
            ) : null}
          </View>
        )}
      />

      <View style={[styles.composer, { paddingBottom: insets.bottom + spacing.sm }]}>
        <TextInput
          accessibilityLabel="Message to Buddy"
          multiline
          maxLength={1200}
          placeholder={`Message ${name}…`}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          value={draft}
          onChangeText={setDraft}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send message"
          disabled={!draft.trim() || busy}
          onPress={() => void send()}
          style={({ pressed }) => [
            styles.sendButton,
            (!draft.trim() || busy) && styles.sendDisabled,
            pressed && styles.pressed,
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.onInverse} size="small" />
          ) : (
            <Ionicons name="send" size={18} color={colors.onInverse} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    centered: { alignItems: 'center', justifyContent: 'center' },
    companion: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    companionCopy: { flex: 1 },
    companionName: { color: colors.text, fontSize: 18, fontWeight: '700' },
    companionMeta: { color: colors.accent, fontSize: 12, marginTop: 3 },
    companionNote: { color: colors.textFaint, fontSize: 11, marginTop: 5, lineHeight: 15 },
    list: { flex: 1 },
    listContent: { padding: spacing.lg, gap: spacing.sm },
    emptyCard: { padding: spacing.md, gap: 6, marginTop: spacing.xl },
    emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    emptyText: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
    bubble: { maxWidth: '86%', padding: spacing.md, borderRadius: radius.md },
    userBubble: { alignSelf: 'flex-end', backgroundColor: colors.accentStrong },
    buddyBubble: { alignSelf: 'flex-start', backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    bubbleText: { color: colors.text, fontSize: 14, lineHeight: 20 },
    userText: { color: colors.onInverse },
    sourceText: { color: colors.textFaint, fontSize: 10, marginTop: 6 },
    composer: {
      flexDirection: 'row',
      gap: spacing.sm,
      alignItems: 'flex-end',
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.background,
    },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      padding: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.text,
      fontSize: 14,
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentStrong,
    },
    sendDisabled: { opacity: 0.45 },
    pressed: { opacity: 0.8 },
  });
