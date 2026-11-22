import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand } from '@/components/Brand';
import { ChatBubble } from '@/components/ChatBubble';
import { ChatHistoryPanel } from '@/components/ChatHistoryPanel';
import { FormError } from '@/components/FormError';
import { SidebarButton } from '@/components/SidebarButton';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { runAgent } from '@/lib/ai/agent';
import { isAiConfigured, loadAiSettings } from '@/lib/ai/settings';
import {
  getChatStore,
  type ChatMessage,
  type Conversation,
} from '@/lib/chat';
import { MASTER_AGENT } from '@/lib/permissions';
import { fonts, radius, spacing } from '@/theme';


const SUGGESTIONS = [
  'Remind me to drink water at 6pm',
  'Add task pay electricity bill tomorrow 10am',
  "What's pending?",
];

export default function ChatScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const store = getChatStore(db);
  const {
    prompt,
    t: promptStamp,
    c: conversationParam,
    n: newParam,
    h: historyParam,
  } = useLocalSearchParams<{ prompt?: string; t?: string; c?: string; n?: string; h?: string }>();
  const handledPromptRef = useRef<string | null>(null);
  const handledNavRef = useRef<string | null>(null);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const activeIdRef = useRef<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyManualOpen, setHistoryManualOpen] = useState(false);
  const [historyDismissedKey, setHistoryDismissedKey] = useState<string | null>(null);
  // The drawer can deep-link here with ?h=1 — derive panel visibility from the
  // param instead of setState-ing inside an effect (avoids cascading renders).
  const historyNavKey = historyParam ? `${promptStamp ?? ''}|${historyParam}` : null;
  const historyOpen =
    historyManualOpen || (historyNavKey !== null && historyDismissedKey !== historyNavKey);

  function openHistoryPanel() {
    setHistoryManualOpen(true);
  }

  function closeHistoryPanel() {
    setHistoryManualOpen(false);

    if (historyNavKey !== null) {
      setHistoryDismissedKey(historyNavKey);
    }
  }
  const [creatorMode, setCreatorMode] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      const [list, settings] = await Promise.all([
        store.listConversations(user.id),
        loadAiSettings(),
      ]);

      setAiReady(isAiConfigured(settings));

      let currentId = activeIdRef.current;

      if (currentId === null || !list.some((item) => item.id === currentId)) {
        currentId = list[0]?.id ?? null;
        activeIdRef.current = currentId;
        setActiveId(currentId);
      }

      const nextMessages =
        currentId === null ? [] : await store.listMessages(user.id, currentId, 200);

      setConversations(list);
      setMessages(nextMessages);
    } catch (loadError) {
      console.warn('Could not load the conversation.', loadError);
    }
  }, [store, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  // Quick actions on Home open the chat with the composer pre-filled (not auto-sent).
  useEffect(() => {
    if (typeof prompt !== 'string' || prompt.length === 0) {
      return;
    }

    const key = `${promptStamp ?? ''}:${prompt}`;

    if (handledPromptRef.current === key) {
      return;
    }

    handledPromptRef.current = key;
    setInput(prompt);
  }, [prompt, promptStamp]);

  // The drawer links here with ?c=<id> (open a chat), ?n=1 (new chat) or ?h=1 (history).
  useEffect(() => {
    if (!user || (!conversationParam && !newParam && !historyParam)) {
      return;
    }

    const key = `${promptStamp ?? ''}|${conversationParam ?? ''}|${newParam ?? ''}|${historyParam ?? ''}`;

    if (handledNavRef.current === key) {
      return;
    }

    handledNavRef.current = key;
    const userId = user.id;

    if (historyParam) {
      return;
    }

    if (conversationParam) {
      const id = Number(conversationParam);

      if (!Number.isFinite(id)) {
        return;
      }

      activeIdRef.current = id;

      void (async () => {
        try {
          const list = await store.listMessages(userId, id, 200);
          setActiveId(id);
          setMessages(list);
        } catch (openError) {
          console.warn('Could not open that chat.', openError);
        }
      })();
      return;
    }

    void (async () => {
      try {
        const list = await store.listConversations(userId);
        const empty = list.find((item) => item.messageCount === 0 && item.title === 'New chat');
        const target = empty ?? (await store.createConversation(userId));

        activeIdRef.current = target.id;
        setActiveId(target.id);
        setMessages([]);
        setConversations(empty ? list : [target, ...list]);
      } catch (createError) {
        console.warn('Could not start a new chat.', createError);
      }
    })();
  }, [conversationParam, historyParam, newParam, promptStamp, store, user]);

  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });

    return () => subscription.remove();
  }, []);

  if (!user) {
    return null;
  }

  const activeUser = user;

  function openHistory() {
    Keyboard.dismiss();
    openHistoryPanel();
  }

  async function refreshConversations() {
    const list = await store.listConversations(activeUser.id);
    setConversations(list);
  }

  async function send(rawText?: string) {
    if (isSending) {
      return;
    }

    const text = (rawText ?? input).trim();

    if (!text) {
      return;
    }

    setInput('');
    setError(null);
    setIsSending(true);

    try {
      let conversationId = activeIdRef.current;

      if (conversationId === null) {
        const created = await store.createConversation(activeUser.id);
        conversationId = created.id;
        activeIdRef.current = conversationId;
        setActiveId(conversationId);
        setConversations((current) => [created, ...current]);
      }

      const userMessage = await store.addMessage(
        activeUser.id,
        conversationId,
        'user',
        text
      );
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);

      const settings = await loadAiSettings();
      setAiReady(isAiConfigured(settings));

      const history = nextMessages
        .filter((message) => message.content.trim().length > 0)
        .slice(-20)
        .map((message) => ({ role: message.role, content: message.content }));

      const result = await runAgent({
        db,
        userId: activeUser.id,
        userName: activeUser.name,
        history,
        settings,
        conversationId: activeIdRef.current!,
        creatorMode,
        agent: MASTER_AGENT,
        projectId: 'orbit-workspace',
        projectLabel: 'Orbit workspace',
      });

      const assistantMessage = await store.addMessage(
        activeUser.id,
        conversationId,
        'assistant',
        result.reply,
        result.traces,
        result.artifacts
      );

      setMessages((current) => [...current, assistantMessage]);
      await refreshConversations();
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : 'Something went wrong. Please try again.'
      );
    } finally {
      setIsSending(false);
    }
  }

  async function startNewChat() {
    if (isSending) {
      return;
    }

    closeHistoryPanel();
    setError(null);

    const current = conversations.find((item) => item.id === activeIdRef.current);

    if (!current || (current.messageCount === 0 && current.title === 'New chat')) {
      setMessages([]);
      return;
    }

    try {
      const created = await store.createConversation(activeUser.id);
      activeIdRef.current = created.id;
      setActiveId(created.id);
      setConversations((prev) => [created, ...prev]);
      setMessages([]);
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : 'Could not start a new chat.'
      );
    }
  }

  async function selectConversation(conversation: Conversation) {
    closeHistoryPanel();

    if (isSending || conversation.id === activeIdRef.current) {
      return;
    }

    setError(null);
    activeIdRef.current = conversation.id;
    setActiveId(conversation.id);

    try {
      setMessages(await store.listMessages(activeUser.id, conversation.id, 200));
    } catch (selectError) {
      setError(
        selectError instanceof Error ? selectError.message : 'Could not load that chat.'
      );
    }
  }

  async function removeConversation(conversation: Conversation) {
    if (isSending) {
      return;
    }

    try {
      await store.deleteConversation(activeUser.id, conversation.id);

      const list = await store.listConversations(activeUser.id);

      if (conversation.id === activeIdRef.current) {
        if (list.length === 0) {
          activeIdRef.current = null;
          setActiveId(null);
          setMessages([]);
        } else {
          const next = list[0];
          activeIdRef.current = next.id;
          setActiveId(next.id);
          setMessages(await store.listMessages(activeUser.id, next.id, 200));
        }
      }

      setConversations(list);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : 'Could not delete that chat.'
      );
    }
  }

  function confirmDeleteConversation(conversation: Conversation) {
    Alert.alert(
      'Delete chat?',
      `“${conversation.title}” and all its messages will be permanently deleted.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void removeConversation(conversation);
          },
        },
      ]
    );
  }

  const activeTitle = conversations.find((item) => item.id === activeId)?.title ?? 'New chat';
  const canSend = !isSending && input.trim().length > 0;
  const firstName = activeUser.name.split(/\s+/)[0] ?? activeUser.name;

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <View style={styles.flex}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <View style={styles.headerRow}>
            <SidebarButton onPress={openSidebar} />

            <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>
              {activeTitle}
            </Text>

            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open chat history"
                onPress={openHistory}
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              >
                <Ionicons name="time-outline" size={21} color={colors.text} />
                {conversations.length > 0 ? (
                  <View style={styles.historyBadge}>
                    <Text style={styles.historyBadgeText}>
                      {conversations.length > 9 ? '9+' : conversations.length}
                    </Text>
                  </View>
                ) : null}
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={creatorMode ? 'Disable creator mode' : 'Enable creator mode'}
                accessibilityState={{ selected: creatorMode }}
                onPress={() => setCreatorMode((prev) => !prev)}
                style={({ pressed }) => [
                  styles.iconButton,
                  creatorMode && { backgroundColor: colors.accentSoft },
                  pressed && styles.pressed,
                ]}
              >
                <Ionicons
                  name={creatorMode ? 'construct' : 'construct-outline'}
                  size={20}
                  color={creatorMode ? colors.accent : colors.text}
                />
              </Pressable>
            </View>
          </View>

          {aiReady === false ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.navigate('/settings')}
              style={({ pressed }) => [styles.modeBanner, pressed && styles.pressed]}
            >
              <Ionicons name="key-outline" size={16} color={colors.accent} />
              <Text style={styles.modeBannerText}>
                Local mode — basic commands only. Add an API key for full AI chat.
              </Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
            </Pressable>
          ) : null}
          {creatorMode ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => setCreatorMode(false)}
              style={({ pressed }) => [styles.modeBanner, pressed && styles.pressed]}
            >
              <Ionicons name="construct" size={16} color={colors.accent} />
              <Text style={styles.modeBannerText}>Creator mode — cordis tools active</Text>
              <Ionicons name="close" size={16} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messageContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Brand size={48} />
              <Text accessibilityRole="header" style={styles.emptyTitle}>
                What’s on your plate, {firstName}?
              </Text>
              <Text style={styles.emptyText}>
                Write in plain language — I’ll create tasks, set reminders and show what’s pending.
                English and Hinglish both work.
              </Text>

              <View style={styles.suggestions}>
                {SUGGESTIONS.map((suggestion) => (
                  <Pressable
                    key={suggestion}
                    accessibilityRole="button"
                    onPress={() => {
                      void send(suggestion);
                    }}
                    style={({ pressed }) => [styles.suggestion, pressed && styles.pressed]}
                  >
                    <Text style={styles.suggestionText}>{suggestion}</Text>
                    <Ionicons name="arrow-up" size={16} color={colors.textMuted} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            messages.map((message) => <ChatBubble key={message.id} message={message} />)
          )}

          {isSending ? (
            <View style={styles.typing} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.typingText}>Orbit is thinking…</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>

      <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {error ? (
          <View style={styles.errorWrap}>
            <FormError message={error} onDismiss={() => setError(null)} />
          </View>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Chat with Orbit"
            accessibilityLabel="Message Orbit"
            placeholderTextColor={colors.textFaint}
            selectionColor={colors.accent}
            style={styles.input}
            multiline
            maxLength={1500}
            editable={!isSending}
          />

          <View style={styles.composerRow}>
            {aiReady !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={aiReady ? 'Cloud AI is on. Open settings' : 'Local mode. Open settings'}
                onPress={() => router.navigate('/settings')}
                style={({ pressed }) => [styles.modePill, pressed && styles.pressed]}
              >
                <Ionicons
                  name={aiReady ? 'sparkles' : 'hardware-chip-outline'}
                  size={15}
                  color={aiReady ? colors.accent : colors.textMuted}
                />
                <Text style={styles.modePillText}>{aiReady ? 'Cloud AI' : 'Local mode'}</Text>
              </Pressable>
            ) : (
              <View />
            )}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={!canSend}
              onPress={() => {
                void send();
              }}
              style={({ pressed }) => [
                styles.sendButton,
                canSend ? styles.sendEnabled : styles.sendDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="arrow-up" size={22} color={canSend ? colors.white : colors.textFaint} />
            </Pressable>
          </View>
        </View>

        <Text style={styles.disclaimer}>
          Messages go to your AI provider · tasks stay on this device
        </Text>
      </View>

      <ChatHistoryPanel
        visible={historyOpen}
        conversations={conversations}
        activeId={activeId}
        busy={isSending}
        onClose={closeHistoryPanel}
        onSelect={(conversation) => {
          void selectConversation(conversation);
        }}
        onNew={() => {
          void startNewChat();
        }}
        onDelete={confirmDeleteConversation}
      />
    </KeyboardAvoidingView>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: {
      flex: 1,
    },
    header: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.sm,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    headerTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
      textAlign: 'center',
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    iconButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    historyBadge: {
      position: 'absolute',
      top: 2,
      right: 2,
      minWidth: 17,
      height: 17,
      borderRadius: 9,
      paddingHorizontal: 4,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    historyBadgeText: {
      color: colors.onInverse,
      fontSize: 10,
      fontWeight: '700',
    },
    modeBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      marginTop: spacing.sm,
    },
    modeBannerText: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    messageContent: {
      flexGrow: 1,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      paddingBottom: spacing.lg,
      gap: spacing.lg,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xl,
      gap: spacing.sm,
    },
    emptyTitle: {
      color: colors.text,
      fontFamily: fonts.serif,
      fontSize: 28,
      fontWeight: '600',
      letterSpacing: -0.3,
      textAlign: 'center',
      marginTop: spacing.md,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 15,
      lineHeight: 22,
      textAlign: 'center',
      maxWidth: 330,
    },
    suggestions: {
      alignSelf: 'stretch',
      gap: spacing.sm,
      marginTop: spacing.lg,
    },
    suggestion: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      minHeight: 52,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
    },
    suggestionText: {
      flex: 1,
      color: colors.text,
      fontSize: 15,
      lineHeight: 21,
    },
    typing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    typingText: {
      color: colors.textMuted,
      fontSize: 14,
    },
    composerWrap: {
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      gap: spacing.xs,
    },
    errorWrap: {
      marginBottom: spacing.xs,
    },
    composer: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.xs,
      paddingBottom: spacing.sm,
    },
    input: {
      color: colors.text,
      fontSize: 17,
      lineHeight: 24,
      maxHeight: 140,
      minHeight: 48,
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
      paddingHorizontal: spacing.xs,
    },
    composerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    modePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      height: 44,
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
    },
    modePillText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    sendButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendEnabled: {
      backgroundColor: colors.accent,
    },
    sendDisabled: {
      backgroundColor: colors.surfaceAlt,
    },
    disclaimer: {
      color: colors.textFaint,
      fontSize: 12,
      textAlign: 'center',
      paddingBottom: 2,
    },
    pressed: {
      opacity: 0.8,
    },
  });
