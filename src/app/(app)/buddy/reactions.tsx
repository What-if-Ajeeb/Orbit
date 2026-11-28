import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BuddyDetailHeader } from '@/components/buddy/BuddyDetailHeader';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { useBuddyReactions } from '@/context/buddy-reactions';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { useRouteBuddy } from '@/hooks/useRouteBuddy';
import { listBuddyReactions, type BuddyReactionRecord } from '@/lib/buddy';
import { spacing } from '@/theme';

function timeLabel(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function BuddyReactionsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { user } = useSession();
  const { buddy, loading } = useRouteBuddy();
  const { recent } = useBuddyReactions();
  const [stored, setStored] = useState<BuddyReactionRecord[]>([]);

  useEffect(() => {
    if (!user || !buddy) return;
    let cancelled = false;
    void listBuddyReactions(db, user.id, 100)
      .then((rows) => {
        if (!cancelled) setStored(rows);
      })
      .catch((error) => console.warn('Buddy reaction history could not load.', error));
    return () => {
      cancelled = true;
    };
  }, [buddy, db, user]);

  const history = stored.length > 0 ? stored : recent;

  if (loading || !buddy) {
    return (
      <View style={[styles.root, styles.centered]}>
        <GlassBackdrop />
        <BuddyDetailHeader title="Reaction History" />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <GlassBackdrop />
      <BuddyDetailHeader title="Reaction History" />
      <FlatList
        data={history}
        keyExtractor={(item, index) => `${item.eventKey}:${item.createdAt}:${index}`}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <GlassView style={styles.emptyCard}>
            <Ionicons name="sparkles-outline" size={26} color={colors.accent} />
            <Text style={styles.emptyTitle}>No reactions yet</Text>
            <Text style={styles.emptyText}>
              Buddy reactions appear here when tasks, tools, approvals or interactions happen.
            </Text>
          </GlassView>
        }
        renderItem={({ item }) => (
          <GlassView style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.eventType}>{item.eventType.replace(/_/g, ' ')}</Text>
              <Text style={styles.time}>{timeLabel(item.createdAt)}</Text>
            </View>
            <Text style={styles.message}>{item.message}</Text>
            <Text style={styles.meta}>
              {item.animation} · {item.mood} · {item.presentation}
            </Text>
          </GlassView>
        )}
      />
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    centered: { alignItems: 'center', justifyContent: 'center' },
    content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
    card: { padding: spacing.md, gap: 6 },
    cardHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
    eventType: { color: colors.accent, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
    time: { color: colors.textFaint, fontSize: 11 },
    message: { color: colors.text, fontSize: 14, lineHeight: 19 },
    meta: { color: colors.textFaint, fontSize: 11, textTransform: 'capitalize' },
    emptyCard: { padding: spacing.lg, alignItems: 'center', gap: 8, marginTop: spacing.xl },
    emptyTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
    emptyText: { color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: 'center' },
  });
