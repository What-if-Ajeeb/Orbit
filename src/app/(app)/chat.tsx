import Ionicons from '@expo/vector-icons/Ionicons';
import { BlurTargetView, BlurView } from 'expo-blur';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState, type ComponentRef } from 'react';
import {
  ActivityIndicator,
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
import { FormError } from '@/components/FormError';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useSession } from '@/context/auth';
import { runAgent } from '@/lib/ai/agent';
import { isAiConfigured, loadAiSettings } from '@/lib/ai/settings';
import { addMessage, listMessages, type ChatMessage } from '@/lib/chat';
import { colors, radius, spacing } from '@/theme';

const SUGGESTIONS = [
  'Remind me to drink water at 6pm',
  'Add task pay electricity bill tomorrow 10am',
  "What's pending?",
];

export default function ChatScreen() {
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const blurTargetRef = useRef<ComponentRef<typeof View> | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composerHeight, setComposerHeight] = useState(0);

  const load = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      const [nextMessages, settings] = await Promise.all([
        listMessages(db, user.id, 100),
        loadAiSettings(),
      ]);

      setMessages(nextMessages);
      setAiReady(isAiConfigured(settings));
    } catch (loadError) {
      console.warn('Could not load the conversation.', loadError);
    }
  }, [db, user]);

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
      const userMessage = await addMessage(db, activeUser.id, 'user', text);
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

      const assistantMessage = await addMessage(
        db,
        activeUser.id,
        'assistant',
        result.reply,
        result.traces
      );

      setMessages((current) => [...current, assistantMessage]);
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

  return (
    <KeyboardAvoidingView style={styles.root} behavior="padding">
      <View pointerEvents="none" style={styles.glow} />

      <BlurTargetView ref={blurTargetRef} style={styles.flex}>
        <View style={[styles.header, { paddingTop: insets.top + spacing.md }]}>
          <ScreenHeader
            eyebrow="ORBIT AGENT"
            title="Chat"
            subtitle="Tasks aur reminders, ek hi jagah."
            right={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="AI settings"
                onPress={() => router.push('/settings')}
                style={styles.iconButton}
              >
                <Ionicons name="settings-outline" size={19} color={colors.textMuted} />
              </Pressable>
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
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  glow: {
    position: 'absolute',
    top: -160,
    right: -110,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.accentSoft,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(16, 26, 44, 0.68)',
    borderWidth: 1,
    borderColor: 'rgba(148, 177, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  modeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(109, 139, 255, 0.25)',
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
    backgroundColor: 'rgba(16, 26, 44, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(148, 177, 255, 0.16)',
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
    borderTopColor: 'rgba(148, 177, 255, 0.22)',
    backgroundColor: 'rgba(7, 11, 20, 0.55)',
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
    backgroundColor: 'rgba(255, 255, 255, 0.055)',
    borderWidth: 1,
    borderColor: 'rgba(159, 184, 255, 0.22)',
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
