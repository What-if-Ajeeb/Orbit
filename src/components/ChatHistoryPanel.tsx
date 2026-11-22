import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { Conversation } from '@/lib/chat';
import { formatRelative } from '@/lib/dates';
import { radius, spacing } from '@/theme';


type ChatHistoryPanelProps = {
  visible: boolean;
  conversations: Conversation[];
  activeId: number | null;
  busy?: boolean;
  onClose: () => void;
  onSelect: (conversation: Conversation) => void;
  onNew: () => void;
  onDelete: (conversation: Conversation) => void;
};

function ConversationRow({
  conversation,
  active,
  onSelect,
  onDelete,
}: {
  conversation: Conversation;
  active: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const countLabel = `${conversation.messageCount} ${
    conversation.messageCount === 1 ? 'message' : 'messages'
  }`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onSelect}
      onLongPress={onDelete}
      style={({ pressed }) => [
        styles.row,
        active && styles.rowActive,
        pressed && styles.pressed,
      ]}
    >
      <View style={[styles.rowIcon, active && styles.rowIconActive]}>
        <Ionicons
          name={active ? 'chatbubble-ellipses' : 'chatbubble-ellipses-outline'}
          size={16}
          color={active ? colors.accent : colors.textMuted}
        />
      </View>

      <View style={styles.rowText}>
        <Text numberOfLines={1} style={[styles.rowTitle, active && styles.rowTitleActive]}>
          {conversation.title}
        </Text>
        <Text style={styles.rowMeta}>
          {countLabel} · {formatRelative(conversation.updatedAt)}
        </Text>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Delete ${conversation.title}`}
        hitSlop={8}
        onPress={onDelete}
        style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]}
      >
        <Ionicons name="trash-outline" size={15} color={colors.textFaint} />
      </Pressable>
    </Pressable>
  );
}

export function ChatHistoryPanel({
  visible,
  conversations,
  activeId,
  busy = false,
  onClose,
  onSelect,
  onNew,
  onDelete,
}: ChatHistoryPanelProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [progress] = useState(() => new Animated.Value(0));
  const panelWidth = Math.min(width * 0.88, 350);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 250 : 180,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }

    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });

    return () => subscription.remove();
  }, [onClose, visible]);

  const backdropOpacity = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1],
  });

  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [panelWidth + 24, 0],
  });

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={styles.overlay}
      accessibilityViewIsModal={visible}
    >
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close chat history"
          onPress={onClose}
          style={styles.backdropPress}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.panel,
          {
            width: panelWidth,
            paddingTop: insets.top + spacing.md,
            paddingBottom: Math.max(insets.bottom, spacing.md),
            transform: [{ translateX }],
          },
        ]}
      >
        <View pointerEvents="none" style={styles.glow} />

        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.eyebrow}>ORBIT AGENT</Text>
            <Text style={styles.title}>Chat history</Text>
            <Text style={styles.subtitle}>
              {conversations.length} {conversations.length === 1 ? 'conversation' : 'conversations'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close chat history"
            hitSlop={8}
            onPress={onClose}
            style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
          >
            <Ionicons name="close" size={19} color={colors.textMuted} />
          </Pressable>
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={onNew}
          style={({ pressed }) => [
            styles.newChat,
            busy && styles.newChatDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="add-circle-outline" size={19} color={colors.white} />
          <Text style={styles.newChatText}>New chat</Text>
        </Pressable>

        <FlatList
          data={conversations}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => (
            <ConversationRow
              conversation={item}
              active={item.id === activeId}
              onSelect={() => onSelect(item)}
              onDelete={() => onDelete(item)}
            />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="chatbubbles-outline" size={32} color={colors.textFaint} />
              <Text style={styles.emptyTitle}>No chats yet</Text>
              <Text style={styles.emptyText}>
                Start a new chat — your conversations are saved here.
              </Text>
            </View>
          }
          ListFooterComponent={
            conversations.length > 0 ? (
              <Text style={styles.hint}>Long-press a chat to delete it.</Text>
            ) : undefined
          }
        />
      </Animated.View>
    </Animated.View>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 70,
    elevation: 70,
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(3, 6, 12, 0.42)',
  },
  backdropPress: {
    flex: 1,
  },
  panel: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    backgroundColor: glass.fillStrong,
    borderTopLeftRadius: radius.xl,
    borderBottomLeftRadius: radius.xl,
    borderLeftWidth: 1,
    borderLeftColor: glass.borderBright,
    paddingHorizontal: spacing.md,
    shadowColor: '#000000',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: -10, height: 0 },
    elevation: 24,
    overflow: 'hidden',
  },
  glow: {
    position: 'absolute',
    top: -140,
    right: -90,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: colors.accentSoft,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  headerText: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    color: colors.accent,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    letterSpacing: -0.4,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 12,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: glass.fillSoft,
    borderWidth: 1,
    borderColor: glass.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newChat: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentStrong,
    borderRadius: radius.md,
    minHeight: 46,
    marginTop: spacing.lg,
    shadowColor: colors.accent,
    shadowOpacity: 0.32,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  newChatDisabled: {
    opacity: 0.5,
  },
  newChatText: {
    color: colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  listContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
    flexGrow: 1,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border,
    borderTopColor: glass.borderBright,
    backgroundColor: glass.fillSoft,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  rowActive: {
    backgroundColor: colors.accentSoft,
    borderColor: colors.border,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    backgroundColor: glass.fillSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIconActive: {
    backgroundColor: colors.accentSoft,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  rowTitleActive: {
    color: colors.accent,
  },
  rowMeta: {
    color: colors.textFaint,
    fontSize: 10,
  },
  deleteButton: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xl * 2,
    gap: spacing.sm,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    maxWidth: 240,
  },
  hint: {
    color: colors.textFaint,
    fontSize: 10,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  pressed: {
    opacity: 0.78,
  },
  });
