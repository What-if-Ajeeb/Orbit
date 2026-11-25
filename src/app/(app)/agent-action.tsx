import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AgentActionCard } from '@/components/actions/AgentActionCard';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { getAgentAction } from '@/lib/agent-actions/service';
import type { AgentActionRecord } from '@/lib/agent-actions/types';
import { radius, spacing } from '@/theme';

export default function AgentActionScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const { user } = useSession();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [action, setAction] = useState<AgentActionRecord | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void (async () => {
        if (!user || !id) {
          return;
        }

        try {
          const found = await getAgentAction(db, id);

          if (active) {
            setAction(found && found.userId === user.id ? found : null);
          }
        } catch {
          if (active) {
            setAction(null);
          }
        }
      })();

      return () => {
        active = false;
      };
    }, [db, id, user])
  );

  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Go back"
        onPress={() => router.back()}
        style={styles.back}
      >
        <Ionicons name="arrow-back" size={18} color={colors.text} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <Text accessibilityRole="header" style={styles.heading}>
        Agent action
      </Text>
      <Text style={styles.intro}>
        Review the exact target and payload. Nothing runs until you approve it, and editing invalidates
        approval.
      </Text>

      {id ? (
        <AgentActionCard key={id} actionId={id} />
      ) : (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>This action is no longer available.</Text>
        </View>
      )}

      {action?.trace ? (
        <View style={styles.traceBox}>
          <Text style={styles.sectionLabel}>Execution trace</Text>
          <Text selectable style={styles.traceText}>
            {action.trace}
          </Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    content: {
      flexGrow: 1,
      gap: spacing.sm,
      padding: spacing.md,
      paddingBottom: spacing.xl,
    },
    back: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingVertical: spacing.xs,
    },
    backText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    heading: {
      color: colors.text,
      fontSize: 24,
      fontWeight: '700',
    },
    intro: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
    },
    empty: {
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      padding: spacing.md,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 13,
    },
    traceBox: {
      gap: 4,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      padding: spacing.md,
    },
    sectionLabel: {
      color: colors.textFaint,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    traceText: {
      color: colors.textMuted,
      fontFamily: 'monospace',
      fontSize: 11,
      lineHeight: 16,
    },
  });
