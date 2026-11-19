import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { ChatMessage } from '@/lib/chat';
import { colors, radius, spacing } from '@/theme';

type ChatBubbleProps = {
  message: ChatMessage;
};

export function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = message.role === 'user';

  return (
    <View style={[styles.wrap, isUser ? styles.wrapUser : styles.wrapAssistant]}>
      {!isUser ? (
        <View style={styles.agentRow}>
          <Ionicons name="sparkles" size={12} color={colors.accent} />
          <Text style={styles.agentLabel}>ORBIT</Text>
        </View>
      ) : null}

      <View style={[styles.bubble, isUser ? styles.userBubble : styles.assistantBubble]}>
        <Text style={[styles.text, isUser && styles.userText]}>{message.content}</Text>
      </View>

      {message.traces.length > 0 ? (
        <View style={styles.traces}>
          {message.traces.map((trace, index) => (
            <View key={`${trace}-${index}`} style={styles.traceRow}>
              <Ionicons name="checkmark-circle" size={12} color={colors.success} />
              <Text style={styles.traceText}>{trace}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    maxWidth: '86%',
    gap: 5,
  },
  wrapUser: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  wrapAssistant: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  agentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingLeft: 2,
  },
  agentLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.4,
  },
  bubble: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    borderWidth: 1,
  },
  userBubble: {
    backgroundColor: colors.accentStrong,
    borderColor: 'transparent',
    borderBottomRightRadius: 6,
  },
  assistantBubble: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderBottomLeftRadius: 6,
  },
  text: {
    color: colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  userText: {
    color: colors.white,
  },
  traces: {
    gap: 4,
    paddingLeft: 2,
  },
  traceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  traceText: {
    color: colors.textMuted,
    fontSize: 12,
  },
});
