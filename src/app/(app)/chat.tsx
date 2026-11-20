import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurTargetView, BlurView } from 'expo-blur';
import { useFocusEffect, useRouter } from 'expo-router';
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
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { ChatHistoryPanel } from '@/components/ChatHistoryPanel';
import { FormError } from '@/components/FormError';
import { ScreenHeader } from '@/components/ScreenHeader';
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
import { radius, spacing } from '@/theme';


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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const blurTargetRef = useRef<ComponentRef<typeof View> | null>(null);
  const activeIdRef = useRef<number | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);

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
    setHistoryOpen(true);
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
      });

      const assistantMessage = await store.addMessage(
        activeUser.id,
        conversationId,
        'assistant',
        result.reply,
        result.traces
      );

      setMessages((current) => [...current, assistantMessage]);
      await refreshConversations();
    } catch (sendError) {
      setError(
        sendError instanceof Error
          ? sendError.message
          : 'Kuch galat ho gaya. Dobara try karo.'
      );
    } finally {
      setIsSending(false);
    }
  }

  async function startNewChat() {
    if (isSending) {
      return;
    }

    setHistoryOpen(false);
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
        createError instanceof Error ? createError.message : 'New chat nahi ban payi.'
      );
    }
  }

  async function selectConversation(conversation: Conversation) {
    setHistoryOpen(false);

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
        selectError instanceof Error ? selectError.message : 'Chat load nahi ho payi.'
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
        deleteError instanceof Error ? deleteError.message : 'Chat delete nahi ho payi.'
      );
    }
  }

  function confirmDeleteConversation(conversation: Conversation) {
    Alert.alert(
      'Delete chat?',
      `“${conversation.title}” aur uske messages permanently delete ho jayenge.`,
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

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <GlassBackdrop />

      <BlurTargetView ref={blurTargetRef} style={styles.flex}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <ScreenHeader
            eyebrow="ORBIT AGENT"
            title="Chat"
            subtitle="Tasks aur reminders, ek hi jagah."
            left={<SidebarButton onPress={openSidebar} style={styles.menuButton} />}
            right={
              <View style={styles.headerActions}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open chat history"
                  onPress={openHistory}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                >
                  <Ionicons name="time-outline" size={19} color={colors.textMuted} />
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
                  accessibilityLabel="AI settings"
                  onPress={() => router.push('/settings')}
                  style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
                >
                  <Ionicons name="settings-outline" size={19} color={colors.textMuted} />
                </Pressable>
              </View>
            }
          />

          {aiReady === false ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [styles.modeBanner, pressed && styles.pressed]}
            >
              <Ionicons name="key-outline" size={15} color={colors.accent} />
              <Text style={styles.modeBannerText}>
                Local mode — basic commands. Full AI chat ke liye key add karo.
              </Text>
              <Ionicons name="chevron-forward" size={14} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={[
            styles.messageContent,
            { paddingBottom: spacing.lg + composerHeight },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        >
          {messages.length === 0 ? (
            <View style={styles.empty}>
              <Brand size={54} />
              <Text style={styles.emptyTitle}>Kya karna hai?</Text>
              <Text style={styles.emptyText}>
                Natural language me likho — main task bana dunga, reminder laga dunga, aur
                pending list bhi dikha dunga.
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
                    <Ionicons name="arrow-up-circle-outline" size={15} color={colors.accent} />
                  </Pressable>
                ))}
              </View>
            </View>
          ) : (
            messages.map((message) => <ChatBubble key={message.id} message={message} />)
          )}

          {isSending ? (
            <View style={styles.typing}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.typingText}>Orbit soch raha hai…</Text>
            </View>
          ) : null}
        </ScrollView>
      </BlurTargetView>

      <View
        style={[styles.composerShell, composerHeight > 0 ? { marginTop: -composerHeight } : null]}
        onLayout={(event) => {
          const next = Math.round(event.nativeEvent.layout.height);
          setComposerHeight((current) => (current === next ? current : next));
        }}
      >
        <BlurView
          blurTarget={blurTargetRef}
          blurMethod="dimezisBlurViewSdk31Plus"
          blurReductionFactor={6}
          intensity={48}
          tint="dark"
          pointerEvents="none"
          style={StyleSheet.absoluteFill}
        />
        <View pointerEvents="none" style={styles.glassTint} />
        <View pointerEvents="none" style={styles.glassHighlight} />

        <View style={styles.composer}>
          {error ? (
            <View style={styles.errorWrap}>
              <FormError message={error} />
            </View>
          ) : null}

          <View style={styles.inputRow}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask Orbit…"
              placeholderTextColor={colors.textFaint}
              selectionColor={colors.accent}
              style={styles.input}
              multiline
              maxLength={1500}
              editable={!isSending}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send message"
              disabled={isSending || input.trim().length === 0}
              onPress={() => {
                void send();
              }}
              style={({ pressed }) => [
                styles.sendButton,
                (isSending || input.trim().length === 0) && styles.sendDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="arrow-up" size={19} color={colors.white} />
            </Pressable>
          </View>

          <Text style={styles.disclaimer}>
            Chat provider ko jaati hai · tasks yahin device par rehte hain
          </Text>
        </View>
      </View>

      <ChatHistoryPanel
        visible={historyOpen}
        conversations={conversations}
        activeId={activeId}
        busy={isSending}
        onClose={() => setHistoryOpen(false)}
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

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 18,
  },
  menuButton: {
    marginTop: 16,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: glass.fillStrong,
    borderWidth: 1,
    borderColor: glass.border,
    borderTopColor: glass.borderBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyBadge: {
    position: 'absolute',
    top: -3,
    right: -3,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 4,
    backgroundColor: colors.accentStrong,
    borderWidth: 1,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyBadgeText: {
    color: colors.white,
    fontSize: 8,
    fontWeight: '700',
  },
  modeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(109, 139, 255, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(109, 139, 255, 0.28)',
    borderTopColor: glass.borderBright,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  modeBannerText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  messageContent: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    paddingVertical: spacing.xl,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
    marginTop: spacing.md,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    maxWidth: 340,
  },
  suggestions: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  suggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    backgroundColor: glass.fill,
    borderWidth: 1,
    borderColor: glass.border,
    borderTopColor: glass.borderBright,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 3,
    paddingHorizontal: spacing.md,
  },
  suggestionText: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    lineHeight: 18,
  },
  typing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: 2,
  },
  typingText: {
    color: colors.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  composerShell: {
    overflow: 'hidden',
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    borderTopWidth: 1,
    borderTopColor: glass.borderBright,
    backgroundColor: 'rgba(7, 11, 20, 0.48)',
    shadowColor: '#000000',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -8 },
    elevation: 16,
  },
  glassTint: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(7, 11, 20, 0.32)',
  },
  glassHighlight: {
    position: 'absolute',
    top: 0,
    left: '10%',
    right: '10%',
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  composer: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  errorWrap: {
    marginBottom: spacing.xs,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 15,
    lineHeight: 21,
    maxHeight: 120,
    minHeight: 48,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    borderWidth: 1,
    borderColor: glass.border,
    borderTopColor: glass.borderBright,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingTop: 13,
    paddingBottom: 13,
  },
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.accentStrong,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.accent,
    shadowOpacity: 0.45,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  sendDisabled: {
    opacity: 0.4,
  },
  disclaimer: {
    color: colors.textFaint,
    fontSize: 10,
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.8,
  },
  });
