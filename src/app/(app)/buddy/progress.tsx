import Ionicons from '@expo/vector-icons/Ionicons';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BuddyDetailHeader } from '@/components/buddy/BuddyDetailHeader';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { useRouteBuddy } from '@/hooks/useRouteBuddy';
import {
  listBuddyAchievements,
  listCharacterUnlocks,
  listDailyCounters,
  xpProgress,
  type BuddyAchievementRecord,
  type BuddyCharacterUnlockRecord,
} from '@/lib/buddy';
import { DAILY_REWARD_CAPS, REWARDS } from '@/lib/buddy/reward-policy';
import { spacing } from '@/theme';

const ACTION_LABELS: Record<string, string> = {
  taskComplete: 'Tasks',
  taskCompleteHighPriority: 'High-priority tasks',
  chatMessage: 'Chat messages',
  dailyLogin: 'Daily login',
  dailyInteraction: 'Interactions',
  evolutionBonus: 'Evolutions',
};

export default function BuddyProgressScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { user } = useSession();
  const { buddy, loading } = useRouteBuddy();

  const [achievements, setAchievements] = useState<BuddyAchievementRecord[]>([]);
  const [unlocks, setUnlocks] = useState<BuddyCharacterUnlockRecord[]>([]);
  const [counters, setCounters] = useState<{ action: string; count: number }[]>([]);

  useEffect(() => {
    if (!user || !buddy) return;
    let cancelled = false;
    void Promise.all([
      listBuddyAchievements(db, user.id, buddy.id),
      listCharacterUnlocks(db, user.id),
      listDailyCounters(db, user.id, buddy.id),
    ])
      .then(([nextAchievements, nextUnlocks, nextCounters]) => {
        if (cancelled) return;
        setAchievements(nextAchievements);
        setUnlocks(nextUnlocks);
        setCounters(nextCounters);
      })
      .catch((error) => console.warn('Buddy progress could not load.', error));
    return () => {
      cancelled = true;
    };
  }, [buddy, db, user]);

  if (loading || !buddy) {
    return (
      <View style={[styles.root, styles.centered]}>
        <GlassBackdrop />
        <BuddyDetailHeader title="Progression" />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const progress = xpProgress(buddy.xp, buddy.level);
  const unlockedCount = unlocks.filter((entry) => entry.unlockedAt !== null).length;

  return (
    <View style={styles.root}>
      <GlassBackdrop />
      <BuddyDetailHeader title="Buddy Progression" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassView style={styles.card}>
          <Text style={styles.section}>Level {buddy.level}</Text>
          <Text style={styles.metric}>
            {progress.current} / {progress.needed} XP toward the next level
          </Text>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, progress.pct))}%` }]} />
          </View>
          <Text style={styles.note}>
            Level, XP and Bond are identity/progression flavor. They do not grant permissions or improve Agent performance.
          </Text>
        </GlassView>

        <GlassView style={styles.card}>
          <Text style={styles.section}>Today</Text>
          {Object.entries(REWARDS).map(([reason, amount]) => {
            const action = reason as keyof typeof REWARDS;
            const count = counters.find((entry) => entry.action === action)?.count ?? 0;
            const cap = DAILY_REWARD_CAPS[action];
            return (
              <View key={reason} style={styles.row}>
                <Text style={styles.rowLabel}>{ACTION_LABELS[reason] ?? reason}</Text>
                <Text style={styles.rowValue}>
                  {count}/{cap} · +{amount.xp} XP
                </Text>
              </View>
            );
          })}
          <Text style={styles.note}>Rewards are unique per source event and capped per local day.</Text>
        </GlassView>

        <GlassView style={styles.card}>
          <Text style={styles.section}>Achievements</Text>
          {achievements.map((achievement) => {
            const earned = achievement.unlockedAt !== null;
            return (
              <View key={achievement.id} style={styles.row}>
                <View style={styles.rowCopy}>
                  <Text style={[styles.rowLabel, !earned && styles.muted]}>{achievement.title}</Text>
                  <Text style={[styles.note, !earned && styles.muted]}>{achievement.description}</Text>
                </View>
                <Ionicons
                  name={earned ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={earned ? colors.success : colors.textFaint}
                />
              </View>
            );
          })}
        </GlassView>

        <GlassView style={styles.card}>
          <Text style={styles.section}>Characters · {unlockedCount}/{unlocks.length}</Text>
          {unlocks.map((unlock) => {
            const earned = unlock.unlockedAt !== null;
            return (
              <View key={unlock.speciesId} style={styles.row}>
                <Text style={[styles.rowLabel, !earned && styles.muted]}>{unlock.speciesId}</Text>
                <Text style={[styles.rowValue, !earned && styles.muted]}>
                  {earned ? 'Unlocked' : unlock.reason}
                </Text>
              </View>
            );
          })}
        </GlassView>
      </ScrollView>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    centered: { alignItems: 'center', justifyContent: 'center' },
    content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
    card: { padding: spacing.md, gap: 10 },
    section: { color: colors.text, fontSize: 16, fontWeight: '700' },
    metric: { color: colors.textMuted, fontSize: 13 },
    note: { color: colors.textFaint, fontSize: 11, lineHeight: 16 },
    muted: { color: colors.textFaint },
    track: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 4, backgroundColor: colors.accent },
    row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
    rowCopy: { flex: 1, gap: 2 },
    rowLabel: { color: colors.text, fontSize: 13, fontWeight: '600', textTransform: 'capitalize' },
    rowValue: { color: colors.accent, fontSize: 12, textAlign: 'right' },
  });
