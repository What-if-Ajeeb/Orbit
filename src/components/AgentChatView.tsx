import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
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

import { ChatBubble } from '@/components/ChatBubble';
import { ChatHistoryPanel } from '@/components/ChatHistoryPanel';
import { FormError } from '@/components/FormError';
import { SidebarButton } from '@/components/SidebarButton';
import { ToolStatusList } from '@/components/ToolStatusList';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { runAgent } from '@/lib/ai/agent';
import type { LlmAttachment } from '@/lib/ai/types';
import { OllamaRequestError } from '@/lib/ai/ollama';
import { isAiConfigured, loadAiSettings, type AiSettings } from '@/lib/ai/settings';
import {
  pickDocuments,
  pickImages,
  toChatAttachments,
  toLlmAttachments,
  type PickedAttachment,
} from '@/lib/chat-attachments';
import { getChatStore, type ChatMessage, type Conversation, type ToolExecutionEvent } from '@/lib/chat';
import type { AgentIdentity } from '@/lib/permissions';
import { fonts, radius, spacing } from '@/theme';

const ATTACHMENT_LIMIT = 4;

type AgentChatViewProps = {
  agent: AgentIdentity;
  /** Conversation scope. Defaults to the agent id; master chat uses `master`. */
  agentId?: string | null;
  allowCreatorMode?: boolean;
};

type RetryPayload = {
  text: string;
  attachments: PickedAttachment[];
};

function describeAiMode(settings: AiSettings): string {
  if (!isAiConfigured(settings)) {
    return 'Local mode';
  }

  return settings.provider === 'ollama' && settings.mode === 'local'
    ? 'On-device AI'
    : 'Cloud AI';
}

function isCancelledError(error: unknown): boolean {
  return (
    (error instanceof OllamaRequestError && error.code === 'cancelled') ||
    (error instanceof Error && error.message === 'AI request cancelled.')
  );
}

function looksOffline(error: unknown): boolean {
  const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  const message = text.toLowerCase();
  return (
    message.includes('network') ||
    message.includes('offline') ||
    message.includes('failed to fetch') ||
    message.includes('could not reach')
  );
}

function historyAttachments(message: ChatMessage): LlmAttachment[] {
  return (message.attachments ?? []).map((attachment) => ({
    name: attachment.name,
    kind: attachment.kind,
    mimeType: attachment.mimeType,
    data: attachment.kind === 'document' ? (attachment.textPreview ?? '') : '',
  }));
}

export function AgentChatView({ agent, agentId, allowCreatorMode = false }: AgentChatViewProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const store = getChatStore(db);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const scopeAgentId = agentId ?? agent.id;
  const {
    prompt,
    t: promptStamp,
    c: conversationParam,
    n: newParam,
    h: historyParam,
  } = useLocalSearchParams<{ prompt?: string; t?: string; c?: string; n?: string; h?: string }>();

  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const activeIdRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const streamRef = useRef('');
  const handledPromptRef = useRef<string | null>(null);
  const handledNavRef = useRef<string | null>(null);
  const toolEventsRef = useRef<Map<string, ToolExecutionEvent>>(new Map());

  const [loading, setLoading] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<PickedAttachment[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [aiLabel, setAiLabel] = useState('Local mode');
  const [streamedText, setStreamedText] = useState('');
  const [liveToolEvents, setLiveToolEvents] = useState<ToolExecutionEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retryPayload, setRetryPayload] = useState<RetryPayload | null>(null);
  const [creatorMode, setCreatorMode] = useState(false);
  const [historyManualOpen, setHistoryManualOpen] = useState(false);
  const [historyDismissedKey, setHistoryDismissedKey] = useState<string | null>(null);

  const historyNavKey = historyParam ? `${promptStamp ?? ''}|${historyParam}` : null;
  const historyOpen =
    historyManualOpen || (historyNavKey !== null && historyDismissedKey !== historyNavKey);

  const load = useCallback(async () => {
    if (!user) {
      return;
    }

    setLoading(true);

    try {
      const [list, settings] = await Promise.all([
        store.listConversations(user.id, 50, scopeAgentId),
        loadAiSettings(),
      ]);

      setAiReady(isAiConfigured(settings));
      setAiLabel(describeAiMode(settings));

      let currentId = activeIdRef.current;

      if (currentId === null || !list.some((item) => item.id === currentId)) {
        currentId = list[0]?.id ?? null;
        activeIdRef.current = currentId;
        setActiveId(currentId);
      }

      setConversations(list);
      setMessages(currentId === null ? [] : await store.listMessages(user.id, currentId, 200));
    } catch (loadError) {
      console.warn('Could not load the agent conversation.', loadError);
      setError(
        loadError instanceof Error ? loadError.message : 'Could not load this conversation.'
      );
    } finally {
      setLoading(false);
    }
  }, [scopeAgentId, store, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  useEffect(() => {
    if (typeof prompt !== 'string' || !prompt.length) {
      return;
    }

    const key = `${promptStamp ?? ''}:${prompt}`;

    if (handledPromptRef.current === key) {
      return;
    }

    handledPromptRef.current = key;
    setInput(prompt);
  }, [prompt, promptStamp]);

  useEffect(() => {
    if (!user || (!conversationParam && !newParam && !historyParam)) {
      return;
    }

    const key = `${promptStamp ?? ''}|${conversationParam ?? ''}|${newParam ?? ''}|${historyParam ?? ''}`;

    if (handledNavRef.current === key) {
      return;
    }

    handledNavRef.current = key;

    if (historyParam) {
      return;
    }

    const userId = user.id;

    if (conversationParam) {
      const id = Number(conversationParam);

      if (!Number.isFinite(id)) {
        return;
      }

      activeIdRef.current = id;

      void (async () => {
        try {
          setActiveId(id);
          setMessages(await store.listMessages(userId, id, 200));
        } catch (openError) {
          setError(
            openError instanceof Error ? openError.message : 'Could not open that chat.'
          );
        }
      })();
      return;
    }

    void (async () => {
      try {
        const list = await store.listConversations(userId, 50, scopeAgentId);
        const empty = list.find((item) => item.messageCount === 0 && item.title === 'New chat');
        const target = empty ?? (await store.createConversation(userId, 'New chat', scopeAgentId));

        activeIdRef.current = target.id;
        setActiveId(target.id);
        setMessages([]);
        setConversations(empty ? list : [target, ...list]);
      } catch (createError) {
        setError(
          createError instanceof Error ? createError.message : 'Could not start a new chat.'
        );
      }
    })();
  }, [conversationParam, historyParam, newParam, promptStamp, scopeAgentId, store, user]);

  useEffect(() => {
    const subscription = Keyboard.addListener('keyboardDidShow', () => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });

    return () => subscription.remove();
  }, []);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    []
  );

  if (!user) {
    return null;
  }

  const activeUser = user;
  const canSend = !isSending && (input.trim().length > 0 || attachments.length > 0);
  const activeTitle = conversations.find((item) => item.id === activeId)?.title ?? 'New chat';

  function closeHistoryPanel() {
    setHistoryManualOpen(false);

    if (historyNavKey !== null) {
      setHistoryDismissedKey(historyNavKey);
    }
  }

  function openHistory() {
    Keyboard.dismiss();
    setHistoryManualOpen(true);
  }

  function recordToolEvent(event: ToolExecutionEvent) {
    toolEventsRef.current.set(event.id, event);
    setLiveToolEvents(Array.from(toolEventsRef.current.values()));
  }

  async function refreshConversations() {
    setConversations(await store.listConversations(activeUser.id, 50, scopeAgentId));
  }

  async function runTurn(payload: RetryPayload, persistUserMessage: boolean) {
    const text = payload.text.trim();
    const turnAttachments = payload.attachments;

    if (!text && turnAttachments.length === 0) {
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    streamRef.current = '';
    toolEventsRef.current.clear();
    setStreamedText('');
    setLiveToolEvents([]);
    setError(null);
    setRetryPayload(payload);
    setIsSending(true);

    let conversationId: number | null = null;

    try {
      conversationId = activeIdRef.current;

      if (conversationId === null) {
        const created = await store.createConversation(
          activeUser.id,
          'New chat',
          scopeAgentId
        );
        conversationId = created.id;
        activeIdRef.current = created.id;
        setActiveId(created.id);
        setConversations((current) => [created, ...current]);
      }

      if (persistUserMessage) {
        await store.addMessage(
          activeUser.id,
          conversationId,
          'user',
          text,
          [],
          [],
          {
            attachments: toChatAttachments(turnAttachments),
            agentId: scopeAgentId,
          }
        );
      }

      const storedMessages = await store.listMessages(activeUser.id, conversationId, 200);
      setMessages(storedMessages);

      const history = storedMessages
        .filter((message) => message.content.trim().length > 0 || (message.attachments?.length ?? 0) > 0)
        .slice(-20)
        .map((message) =>
          message.role === 'user'
            ? {
                role: 'user' as const,
                content: message.content,
                attachments: historyAttachments(message),
              }
            : { role: 'assistant' as const, content: message.content }
        );

      // Current-turn payloads carry real image data; older history keeps only
      // attachment names and extracted text, never stored secrets.
      const current = history[history.length - 1];

      if (current?.role === 'user' && turnAttachments.length > 0) {
        current.attachments = toLlmAttachments(turnAttachments);
      }

      const settings = await loadAiSettings();
      setAiReady(isAiConfigured(settings));
      setAiLabel(describeAiMode(settings));

      const result = await runAgent({
        db,
        userId: activeUser.id,
        userName: activeUser.name,
        history,
        settings,
        conversationId,
        agent,
        projectId: 'orbit-workspace',
        projectLabel: 'Orbit workspace',
        creatorMode: allowCreatorMode && creatorMode,
        signal: controller.signal,
        onTextDelta: (delta) => {
          streamRef.current += delta;
          setStreamedText(streamRef.current);
        },
        onToolEvent: recordToolEvent,
      });

      const toolEvents = result.toolEvents.length > 0 ? result.toolEvents : liveToolEvents;

      await store.addMessage(
        activeUser.id,
        conversationId,
        'assistant',
        result.reply,
        result.traces,
        result.artifacts,
        { toolEvents, agentId: scopeAgentId }
      );
      setMessages(await store.listMessages(activeUser.id, conversationId, 200));
      setRetryPayload(null);
      await refreshConversations();
    } catch (sendError) {
      if (isCancelledError(sendError)) {
        const partial = streamRef.current.trim();
        const events = Array.from(toolEventsRef.current.values());

        if (partial && conversationId !== null) {
          await store.addMessage(activeUser.id, conversationId, 'assistant', partial, [], [], {
            toolEvents: events,
            agentId: scopeAgentId,
          });
          setMessages(await store.listMessages(activeUser.id, conversationId, 200));
          await refreshConversations();
        }
      } else {
        setError(
          sendError instanceof Error
            ? sendError.message
            : 'Something went wrong. Please try again.'
        );
      }
    } finally {
      abortRef.current = null;
      streamRef.current = '';
      toolEventsRef.current.clear();
      setStreamedText('');
      setLiveToolEvents([]);
      setIsSending(false);
    }
  }

  async function send(rawText?: string) {
    if (isSending) {
      return;
    }

    const text = (rawText ?? input).trim();

    if (!text && attachments.length === 0) {
      return;
    }

    const payload: RetryPayload = { text, attachments: [...attachments] };
    setInput('');
    setAttachments([]);
    await runTurn(payload, true);
  }

  async function retry() {
    if (isSending || !retryPayload) {
      return;
    }

    await runTurn(retryPayload, false);
  }

  async function addPicked(picker: () => Promise<PickedAttachment[]>) {
    try {
      const picked = await picker();

      if (picked.length > 0) {
        setAttachments((current) => [...current, ...picked].slice(0, ATTACHMENT_LIMIT));
        setError(null);
      }
    } catch (pickerError) {
      setError(
        pickerError instanceof Error ? pickerError.message : 'Could not attach that file.'
      );
    }
  }

  async function startNewChat() {
    if (isSending) {
      return;
    }

    closeHistoryPanel();
    setError(null);
    setRetryPayload(null);

    const current = conversations.find((item) => item.id === activeIdRef.current);

    if (!current || (current.messageCount === 0 && current.title === 'New chat')) {
      setMessages([]);
      return;
    }

    try {
      const created = await store.createConversation(activeUser.id, 'New chat', scopeAgentId);
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
    setRetryPayload(null);
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
      const list = await store.listConversations(activeUser.id, 50, scopeAgentId);

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

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <View style={styles.flex}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
          <View style={styles.headerRow}>
            <SidebarButton onPress={openSidebar} />

            <View style={styles.headerTitleWrap}>
              <Text accessibilityRole="header" numberOfLines={1} style={styles.headerTitle}>
                {agent.name}
              </Text>
              <Text numberOfLines={1} style={styles.headerSubtitle}>
                {activeTitle}
              </Text>
            </View>

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
                accessibilityLabel={`${agent.name} tools and memory`}
                onPress={() =>
                  router.push(`/agents/${encodeURIComponent(agent.id)}/tools` as Href)
                }
                style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
              >
                <Ionicons name="options-outline" size={20} color={colors.text} />
              </Pressable>

              {allowCreatorMode ? (
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
              ) : null}
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
                Not connected — basic commands only. Connect an AI provider in Settings.
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
          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.loadingText}>Loading conversation…</Text>
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Ionicons name={agent.icon as keyof typeof Ionicons.glyphMap} size={28} color={colors.accent} />
              </View>
              <Text accessibilityRole="header" style={styles.emptyTitle}>
                Chat with {agent.name}
              </Text>
              <Text style={styles.emptyText}>{agent.description}</Text>
            </View>
          ) : (
            messages.map((message) => <ChatBubble key={message.id} message={message} />)
          )}

          {streamedText ? (
            <ChatBubble
              message={{
                id: -1,
                role: 'assistant',
                content: streamedText,
                traces: [],
                artifacts: [],
                createdAt: 0,
              }}
            />
          ) : null}
          {liveToolEvents.length > 0 ? <ToolStatusList events={liveToolEvents} /> : null}
          {isSending && !streamedText && liveToolEvents.length === 0 ? (
            <View style={styles.typing} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.typingText}>{agent.name} is thinking…</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>

      <View style={[styles.composerWrap, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {error ? (
          <View style={styles.errorWrap}>
            <FormError message={error} onDismiss={() => setError(null)} />
            {retryPayload && !isSending ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void retry();
                }}
                style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
              >
                <Text style={styles.retryText}>
                  {looksOffline(error) ? 'Retry when back online' : 'Retry'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {attachments.length > 0 ? (
          <ScrollView horizontal style={styles.attachmentStrip} showsHorizontalScrollIndicator={false}>
            {attachments.map((attachment) => (
              <View key={attachment.id} style={styles.attachmentChip}>
                <Ionicons
                  name={attachment.kind === 'image' ? 'image-outline' : 'document-text-outline'}
                  size={15}
                  color={colors.accent}
                />
                <Text numberOfLines={1} style={styles.attachmentChipText}>
                  {attachment.name}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${attachment.name}`}
                  onPress={() =>
                    setAttachments((current) => current.filter((item) => item.id !== attachment.id))
                  }
                  hitSlop={8}
                >
                  <Ionicons name="close" size={14} color={colors.textMuted} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        ) : null}

        <View style={styles.composer}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={`Message ${agent.name}`}
            accessibilityLabel={`Message ${agent.name}`}
            placeholderTextColor={colors.textFaint}
            selectionColor={colors.accent}
            style={styles.input}
            multiline
            maxLength={1500}
            editable={!isSending}
          />

          <View style={styles.composerRow}>
            <View style={styles.composerTools}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Attach an image"
                disabled={isSending || attachments.length >= ATTACHMENT_LIMIT}
                onPress={() => {
                  void addPicked(pickImages);
                }}
                style={({ pressed }) => [styles.attachButton, pressed && styles.pressed]}
              >
                <Ionicons name="image-outline" size={20} color={colors.textMuted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Attach a document"
                disabled={isSending || attachments.length >= ATTACHMENT_LIMIT}
                onPress={() => {
                  void addPicked(pickDocuments);
                }}
                style={({ pressed }) => [styles.attachButton, pressed && styles.pressed]}
              >
                <Ionicons name="document-outline" size={20} color={colors.textMuted} />
              </Pressable>
              {aiReady !== null ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${aiLabel}. Open settings`}
                  onPress={() => router.navigate('/settings')}
                  style={({ pressed }) => [styles.modePill, pressed && styles.pressed]}
                >
                  <Text style={styles.modePillText}>{aiLabel}</Text>
                </Pressable>
              ) : null}
            </View>

            {isSending ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop generating"
                onPress={() => abortRef.current?.abort()}
                style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
              >
                <Text style={styles.stopText}>Stop</Text>
              </Pressable>
            ) : (
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
                <Ionicons
                  name="arrow-up"
                  size={22}
                  color={canSend ? colors.onInverse : colors.textFaint}
                />
              </Pressable>
            )}
          </View>
        </View>

        <Text style={styles.disclaimer}>
          Images and text documents stay on this device · tasks stay local
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
    headerTitleWrap: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    headerSubtitle: {
      color: colors.textFaint,
      fontSize: 12,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    iconButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    historyBadge: {
      position: 'absolute',
      top: 1,
      right: 1,
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
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    loadingText: {
      color: colors.textMuted,
      fontSize: 14,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: spacing.xl,
      gap: spacing.sm,
    },
    emptyIcon: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
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
      gap: spacing.xs,
    },
    retryButton: {
      alignSelf: 'flex-start',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceAlt,
    },
    retryText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '700',
    },
    attachmentStrip: {
      maxHeight: 46,
    },
    attachmentChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      marginRight: spacing.sm,
      maxWidth: 220,
    },
    attachmentChipText: {
      color: colors.text,
      fontSize: 13,
      maxWidth: 150,
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
      gap: spacing.sm,
    },
    composerTools: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      flexShrink: 1,
    },
    attachButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modePill: {
      paddingHorizontal: spacing.md,
      height: 40,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      justifyContent: 'center',
    },
    modePillText: {
      color: colors.text,
      fontSize: 13,
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
    stopButton: {
      minWidth: 64,
      height: 48,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stopText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
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
