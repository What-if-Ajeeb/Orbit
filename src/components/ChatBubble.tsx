import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { StyleSheet, Text, View } from 'react-native';

import type { ChatMessage } from '@/lib/chat';
import { radius, spacing } from '@/theme';


type ChatBubbleProps = {
  message: ChatMessage;
};

export function ChatBubble({ message }: ChatBubbleProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const isUser = message.role === 'user';

  return (
    <View style={[styles.wrap, isUser ? styles.wrapUser : styles.wrapAssistant]}>
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

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
  wrap: {
    maxWidth: '92%',
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
  bubble: {},
  userBubble: {
    backgroundColor: colors.surfaceAlt,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  // Assistant replies are plain text on the page, like a document — no bubble.
  assistantBubble: {
    paddingVertical: 2,
  },
  text: {
    color: colors.text,
    fontSize: 16,
    lineHeight: 24,
  },
  userText: {
    color: colors.text,
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
