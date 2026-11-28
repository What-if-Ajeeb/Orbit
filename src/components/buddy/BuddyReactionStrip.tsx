import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { useBuddyReactions } from '@/context/buddy-reactions';
import type { BuddyEventType } from '@/lib/buddy/events';
import { radius, spacing } from '@/theme';

function iconFor(type: BuddyEventType): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'task_completed':
      return 'checkmark-circle-outline';
    case 'task_failed':
      return 'alert-circle-outline';
    case 'approval_required':
    case 'task_waiting':
      return 'time-outline';
    case 'tool_started':
    case 'tool_completed':
    case 'task_progress':
      return 'hardware-chip-outline';
    case 'user_interaction':
      return 'heart-outline';
    case 'agent_idle':
      return 'moon-outline';
    default:
      return 'sparkles-outline';
  }
}

function labelFor(type: BuddyEventType): string {
  return type.replace(/_/g, ' ');
}

export function BuddyReactionStrip() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const { reaction, dismiss } = useBuddyReactions();

  if (!reaction || reaction.presentation !== 'inline') return null;

  return (
    <Pressable
      accessibilityLabel={`Buddy reaction: ${reaction.message}`}
      accessibilityRole="button"
      onPress={dismiss}
      style={({ pressed }) => [styles.strip, pressed && styles.pressed]}
      testID="buddy-reaction-strip"
    >
      <View style={styles.icon}>
        <Ionicons name={iconFor(reaction.eventType)} size={15} color={colors.accent} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.label}>Buddy · {labelFor(reaction.eventType)}</Text>
        <Text numberOfLines={2} style={styles.message}>{reaction.message}</Text>
      </View>
      <Ionicons name="close" size={14} color={colors.textFaint} />
    </Pressable>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    strip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.sm,
      marginBottom: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    pressed: { opacity: 0.8 },
    icon: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    copy: { flex: 1 },
    label: {
      color: colors.accent,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    message: { color: colors.text, fontSize: 13, marginTop: 2 },
  });
