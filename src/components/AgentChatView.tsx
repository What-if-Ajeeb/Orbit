import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AddToChatSheet } from '@/components/AddToChatSheet';
import { AgentActivityTimeline } from '@/components/AgentActivityTimeline';
import { ChatBubble } from '@/components/ChatBubble';
import { ChatHistoryPanel } from '@/components/ChatHistoryPanel';
import { FormError } from '@/components/FormError';
import { SidebarButton } from '@/components/SidebarButton';
import { ToolStatusList } from '@/components/ToolStatusList';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useTabletLayout } from '@/context/tablet-layout';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { runAgent } from '@/lib/ai/agent';
import { AgentTurnCancelledError } from '@/lib/agent-runtime/orchestrator';
import type { AgentTaskStatus, AgentTaskVerification } from '@/lib/agent-runtime/types';
import type { LlmAttachment } from '@/lib/ai/types';
import { OllamaRequestError } from '@/lib/ai/ollama';
import { isAiConfigured, loadAiSettings, type AiSettings } from '@/lib/ai/settings';
import {
  mergeAttachments,
  pickCamera,
  pickDocuments,
  pickImages,
  toChatAttachments,
  toLlmAttachments,
  type PickedAttachment,
} from '@/lib/chat-attachments';
import { getChatStore, type ChatMessage, type Conversation, type ToolExecutionEvent } from '@/lib/chat';
import { setWebSearchPreference } from '@/lib/chat-preferences';
import { permissionManager, type AgentIdentity } from '@/lib/permissions';
import {
  WORKSPACE_PROJECT_ID,
  WORKSPACE_PROJECT_LABEL,
  WORKSPACE_PROJECT_SCOPE,
  listChatProjectScopes,
  type ChatProjectScope,
} from '@/lib/project-scopes';
import type { ActivityRecord } from '@/lib/safety/types';
import { useVoiceInput } from '@/lib/voice-input';
import { fonts, layout, radius, spacing } from '@/theme';

type AgentChatViewProps = {
  agent: AgentIdentity;
  /** Conversation scope. Defaults to the agent id; master chat uses `master`. */
  agentId?: string | null;
  allowCreatorMode?: boolean;
  /** Master chat exposes the composer add menu; specialist chats stay unchanged. */
  showAddMenu?: boolean;
};

type RetryPayload = {
  text: string;
  attachments: PickedAttachment[];
};

type TaskNotice = {
  taskId: string;
  status: AgentTaskStatus;
  verified: boolean;
  reason: string;
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
    error instanceof AgentTurnCancelledError ||
    (error instanceof OllamaRequestError && error.code === 'cancelled') ||
    (error instanceof Error &&
      (error.name === 'AbortError' ||
        error.message === 'AI request cancelled.' ||
        /^(?:tool|operation|request) cancelled/i.test(error.message)))
  );
}

function taskStatusLabel(status: AgentTaskStatus): string {
  if (status === 'completed') return 'completed';
  if (status === 'needs_review') return 'needs review';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed') return 'failed';
  return status.replace(/_/g, ' ');
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

export function AgentChatView({
  agent,
  agentId,
  allowCreatorMode = false,
  showAddMenu = false,
}: AgentChatViewProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const store = getChatStore(db);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const { layout: responsive } = useTabletLayout();
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
  const activeTaskIdRef = useRef<string | null>(null);
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
  const [activity, setActivity] = useState<ActivityRecord[]>([]);
  const [agentStopped, setAgentStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [taskNotice, setTaskNotice] = useState<TaskNotice | null>(null);
  const [retryPayload, setRetryPayload] = useState<RetryPayload | null>(null);
  const [creatorMode, setCreatorMode] = useState(false);
  const [historyManualOpen, setHistoryManualOpen] = useState(false);
  const [historyDismissedKey, setHistoryDismissedKey] = useState<string | null>(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const [selectedProject, setSelectedProject] = useState<ChatProjectScope | null>(null);
  const [projectScopes, setProjectScopes] = useState<ChatProjectScope[]>([WORKSPACE_PROJECT_SCOPE]);
  const voice = useVoiceInput(setInput);

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
      setWebSearchEnabled(settings.webSearch !== false);

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

  const activityUserId = user?.id ?? null;

  useEffect(() => {
    if (activityUserId === null) {
      return;
    }

    let mounted = true;

    const refresh = async () => {
      try {
        const [records, state] = await Promise.all([
          permissionManager.getActivity(activityUserId, undefined, 120),
          Promise.resolve(permissionManager.getState()),
        ]);

        if (!mounted) {
          return;
        }

        setAgentStopped(state.stoppedAgents.includes(agent.id));
        setActivity(
          records.filter(
            (record) =>
              record.agentId === agent.id &&
              (activeId === null ||
                record.conversationId === null ||
                record.conversationId === activeId)
          )
        );
      } catch {
        // Activity is supplementary; a failed read must not break the chat.
      }
    };

    void refresh();
    const unsubscribe = permissionManager.subscribe(() => {
      void refresh();
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [activeId, agent.id, activityUserId]);

  useEffect(() => {
    if (!showAddMenu || !addSheetOpen || activityUserId === null) {
      return;
    }

    let mounted = true;

    void listChatProjectScopes(db, activityUserId)
      .then((scopes) => {
        if (mounted) {
          setProjectScopes(scopes);
        }
      })
      .catch(() => {
        if (mounted) {
          setProjectScopes([WORKSPACE_PROJECT_SCOPE]);
        }
      });

    return () => {
      mounted = false;
    };
  }, [activityUserId, addSheetOpen, db, showAddMenu]);

  if (!user) {
    return null;
  }

  const activeUser = user;
  const canSend =
    !isSending && !agentStopped && (input.trim().length > 0 || attachments.length > 0);
  const activeTitle = conversations.find((item) => item.id === activeId)?.title ?? 'New chat';

  async function stopCurrentAgent() {
    abortRef.current?.abort();

    if (activeTaskIdRef.current) {
      setTaskNotice({
        taskId: activeTaskIdRef.current,
        status: 'cancelled',
        verified: false,
        reason: 'Stop requested. Waiting for the runtime to confirm what stopped.',
      });
    }

    try {
      const report = await permissionManager.stopAgent(activeUser.id, agent.id);
      const lines = [
        `${agent.name} is stopped. No new action can start until you resume it.`,
        `Stop requested for ${report.stopRequested.length} cancellable operation(s); completion is not confirmed.`,
        `Cancelled ${report.cancelledRequests} pending approval(s).`,
        `Revoked ${report.revokedGrants} saved grant(s).`,
      ];

      if (report.uncancellable.length > 0) {
        lines.push(
          `Could not cancel: ${report.uncancellable.join('; ')}. Check the external service before retrying.`
        );
      }

      lines.push('Actions that already finished were not undone.');
      Alert.alert('Agent stopped', lines.join('\n'));
    } catch {
      Alert.alert(
        'Agent stopped',
        `${agent.name} will not start new actions. Some stop details could not be loaded.`
      );
    }
  }

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

  function openAddSheet() {
    Keyboard.dismiss();
    setAddSheetOpen(true);
  }

  function closeAddSheet() {
    setAddSheetOpen(false);
  }

  async function attachFromSheet(picker: () => Promise<PickedAttachment[]>) {
    closeAddSheet();
    await addPicked(picker);
  }

  async function toggleWebSearch(enabled: boolean) {
    setWebSearchEnabled(enabled);

    try {
      const saved = await setWebSearchPreference(db, activeUser.id, scopeAgentId, enabled);
      setWebSearchEnabled(saved.webSearch !== false);
      setError(null);
    } catch (preferenceError) {
      setWebSearchEnabled(!enabled);
      setError(
        preferenceError instanceof Error
          ? preferenceError.message
          : 'Could not update the Web Search preference.'
      );
    }
  }

  function openConnectors() {
    closeAddSheet();
    router.navigate('/connections');
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
    setTaskNotice(null);
    activeTaskIdRef.current = null;
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
        projectId: selectedProject?.id ?? WORKSPACE_PROJECT_ID,
        projectLabel: selectedProject?.label ?? WORKSPACE_PROJECT_LABEL,
        creatorMode: allowCreatorMode && creatorMode,
        signal: controller.signal,
        onTextDelta: (delta) => {
          streamRef.current += delta;
          setStreamedText(streamRef.current);
        },
        onToolEvent: recordToolEvent,
      });

      const toolEvents = result.toolEvents.length > 0 ? result.toolEvents : liveToolEvents;
      const turnStatus: AgentTaskStatus = result.status ?? 'needs_review';
      const turnVerification: AgentTaskVerification = result.verification ?? {
        verified: false,
        status: 'uncertain',
        reason: 'Completion could not be verified.',
        evidence: {},
      };
      const verified = turnStatus === 'completed' && turnVerification.verified;
      activeTaskIdRef.current = result.taskId;
      setTaskNotice({
        taskId: result.taskId,
        status: turnStatus,
        verified,
        reason: turnVerification.reason,
      });

      await store.addMessage(
        activeUser.id,
        conversationId,
        'assistant',
        result.reply,
        result.traces,
        result.artifacts,
        {
          toolEvents,
          agentId: scopeAgentId,
          agentTaskId: result.taskId,
          agentStatus: turnStatus,
          agentVerified: verified,
          verification: turnVerification,
        }
      );
      setMessages(await store.listMessages(activeUser.id, conversationId, 200));
      if (verified) {
        setRetryPayload(null);
      }
      await refreshConversations();
    } catch (sendError) {
      if (isCancelledError(sendError)) {
        const taskId =
          sendError instanceof AgentTurnCancelledError
            ? sendError.taskId
            : activeTaskIdRef.current ?? 'unknown';
        const partial = streamRef.current.trim();
        const events = Array.from(toolEventsRef.current.values());

        setTaskNotice({
          taskId,
          status: 'cancelled',
          verified: false,
          reason: 'Stopped before completion. No completion was verified.',
        });

        if (conversationId !== null) {
          await store.addMessage(
            activeUser.id,
            conversationId,
            'assistant',
            partial
              ? `${partial}\n\nStopped — task ${taskId} was not verified.`
              : `Stopped — task ${taskId} was not verified.`,
            [],
            [],
            {
              toolEvents: events,
              agentId: scopeAgentId,
              agentTaskId: taskId,
              agentStatus: 'cancelled',
              agentVerified: false,
            }
          );
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

    voice.cancel();
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
        setAttachments((current) => mergeAttachments(current, picked));
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
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.flex}>
        <View
          style={[
            styles.header,
            responsive.isTablet && styles.contentWide,
            { paddingTop: insets.top + spacing.sm },
          ]}
        >
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
                <Ionicons name="time-outline" size={20} color={colors.text} />
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
                <Ionicons name="options-outline" size={18} color={colors.text} />
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
                    size={18}
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
          contentContainerStyle={[
            styles.messageContent,
            responsive.isTablet && styles.contentWide,
          ]}
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
          <AgentActivityTimeline
            records={activity}
            onOpenPermissions={() => router.navigate('/permissions')}
          />
          {isSending && !streamedText && liveToolEvents.length === 0 ? (
            <View style={styles.typing} accessibilityLiveRegion="polite">
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.typingText}>{agent.name} is thinking…</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>

      <View
        style={[
          styles.composerWrap,
          responsive.isTablet && styles.contentWide,
          { paddingBottom: Math.max(insets.bottom, spacing.xs) },
        ]}
      >
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

        {taskNotice ? (
          <View style={styles.taskBanner} accessibilityLiveRegion="polite">
            <Ionicons
              name={taskNotice.verified ? 'checkmark-circle-outline' : 'alert-circle-outline'}
              size={15}
              color={taskNotice.verified ? colors.success : colors.accent}
            />
            <View style={styles.taskCopy}>
              <Text style={styles.taskTitle}>
                Task {taskNotice.taskId} · {taskStatusLabel(taskNotice.status)}
              </Text>
              <Text numberOfLines={2} style={styles.taskReason}>
                {taskNotice.reason}
              </Text>
            </View>
            {!taskNotice.verified && retryPayload && !isSending ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  void retry();
                }}
                style={({ pressed }) => [styles.taskRetry, pressed && styles.pressed]}
              >
                <Text style={styles.taskRetryText}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {agentStopped ? (
          <View style={styles.stoppedBanner}>
            <Ionicons name="stop-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.stoppedText}>
              {agent.name} is stopped. New actions are blocked until you resume this agent.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Resume ${agent.name}`}
              onPress={() => {
                void permissionManager.resumeAgent(activeUser.id, agent.id);
              }}
              style={styles.resumeButton}
            >
              <Text style={styles.resumeText}>Resume</Text>
            </Pressable>
          </View>
        ) : null}

        {attachments.length > 0 ? (
          <ScrollView horizontal style={styles.attachmentStrip} showsHorizontalScrollIndicator={false}>
            {attachments.map((attachment) => (
              <View key={attachment.id} style={styles.attachmentChip}>
                {attachment.kind === 'image' ? (
                  <Image source={{ uri: attachment.uri }} style={styles.attachmentThumb} />
                ) : (
                  <Ionicons name="document-text-outline" size={15} color={colors.accent} />
                )}
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

        {voice.error ? <Text style={styles.voiceError}>{voice.error}</Text> : null}

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
            returnKeyType="send"
            blurOnSubmit={false}
            onSubmitEditing={() => {
              if (canSend) {
                void send();
              }
            }}
          />

          <View style={styles.composerRow}>
            <View style={styles.composerTools}>
              {showAddMenu ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add to chat"
                  disabled={isSending}
                  onPress={openAddSheet}
                  style={({ pressed }) => [styles.attachButton, pressed && styles.pressed]}
                >
                  <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
                </Pressable>
              ) : null}
              {voice.available !== false ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={voice.listening ? 'Stop voice input' : 'Voice input'}
                  disabled={isSending}
                  onPress={() => {
                    if (voice.listening) {
                      voice.stop();
                    } else {
                      void voice.start(input);
                    }
                  }}
                  style={({ pressed }) => [
                    styles.attachButton,
                    voice.listening && styles.listeningButton,
                    pressed && styles.pressed,
                  ]}
                >
                  <Ionicons
                    name={voice.listening ? 'mic' : 'mic-outline'}
                    size={18}
                    color={voice.listening ? colors.accent : colors.textMuted}
                  />
                </Pressable>
              ) : null}
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
                accessibilityLabel={`Stop ${agent.name}`}
                onPress={() => {
                  void stopCurrentAgent();
                }}
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
                  size={20}
                  color={canSend ? colors.onInverse : colors.textFaint}
                />
              </Pressable>
            )}
          </View>
        </View>

        {!responsive.keyboardVisible ? (
          <Text style={styles.disclaimer}>
            Images and text documents stay on this device · tasks stay local
          </Text>
        ) : null}
      </View>

      {showAddMenu ? (
        <AddToChatSheet
          visible={addSheetOpen}
          onClose={closeAddSheet}
          onCamera={() => {
            void attachFromSheet(pickCamera);
          }}
          onPhotos={() => {
            void attachFromSheet(pickImages);
          }}
          onFiles={() => {
            void attachFromSheet(pickDocuments);
          }}
          projectScopes={projectScopes}
          selectedProject={selectedProject}
          onSelectProject={setSelectedProject}
          webSearchEnabled={webSearchEnabled}
          onToggleWebSearch={(enabled) => {
            void toggleWebSearch(enabled);
          }}
          onOpenConnectors={openConnectors}
          attachmentCount={attachments.length}
        />
      ) : null}

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
    contentWide: {
      width: '100%',
      maxWidth: layout.contentMaxWidth,
      alignSelf: 'center',
    },
    header: {
      paddingHorizontal: spacing.md,
      paddingBottom: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    headerTitleWrap: {
      flex: 1,
      minWidth: 0,
      alignItems: 'flex-start',
      gap: 1,
      paddingLeft: spacing.xs,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      textAlign: 'left',
    },
    headerSubtitle: {
      color: colors.textFaint,
      fontSize: 11,
      textAlign: 'left',
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 0,
    },
    iconButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    historyBadge: {
      position: 'absolute',
      top: 0,
      right: 0,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      paddingHorizontal: 3,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    historyBadgeText: {
      color: colors.onInverse,
      fontSize: 9,
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
      paddingTop: 4,
      gap: 4,
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
    taskBanner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    taskCopy: {
      flex: 1,
      gap: 2,
    },
    taskTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '700',
    },
    taskReason: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
    },
    taskRetry: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.sm,
      backgroundColor: colors.accentSoft,
    },
    taskRetryText: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '700',
    },
    stoppedBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    stoppedText: {
      flex: 1,
      color: colors.danger,
      fontSize: 11,
      lineHeight: 15,
    },
    resumeButton: {
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceAlt,
    },
    resumeText: {
      color: colors.accent,
      fontSize: 11,
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
    attachmentThumb: {
      width: 26,
      height: 26,
      borderRadius: 7,
      backgroundColor: colors.surfaceAlt,
    },
    attachmentChipText: {
      color: colors.text,
      fontSize: 13,
      maxWidth: 150,
    },
    composer: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm + 2,
      paddingTop: 2,
      paddingBottom: spacing.xs,
    },
    input: {
      color: colors.text,
      fontSize: 16,
      lineHeight: 22,
      maxHeight: 120,
      minHeight: 44,
      paddingTop: spacing.xs,
      paddingBottom: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    composerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.xs,
    },
    composerTools: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      flexShrink: 1,
    },
    attachButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
    },
    listeningButton: {
      backgroundColor: colors.accentSoft,
    },
    voiceError: {
      color: colors.danger,
      fontSize: 12,
      paddingHorizontal: spacing.sm,
      paddingBottom: spacing.xs,
    },
    modePill: {
      paddingHorizontal: spacing.sm,
      height: 36,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      justifyContent: 'center',
    },
    modePillText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    sendButton: {
      width: 44,
      height: 44,
      borderRadius: 22,
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
      minWidth: 60,
      height: 44,
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
      fontSize: 11,
      lineHeight: 14,
      textAlign: 'center',
      paddingBottom: 1,
    },
    pressed: {
      opacity: 0.8,
    },
  });
