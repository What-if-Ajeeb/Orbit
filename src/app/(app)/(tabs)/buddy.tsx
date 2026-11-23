import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Speech from 'expo-speech';

import { BuddyAvatar } from '@/components/buddy/BuddyAvatar';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { SidebarButton } from '@/components/SidebarButton';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  addBond, addXp, ensureStarterBuddy, getForm, getPersonality, getSpecies,
  logBuddyActivity, setBuddyMood, type BuddyAnimationState, type UserBuddy, xpForLevel,
} from '@/lib/buddy';
import { radius, spacing } from '@/theme';

function StatBar({ label, value, max = 100, color }: { label: string; value: number; max?: number; color: string }) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const pct = Math.max(0, Math.min(1, value / max));
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <View style={[styles.statTrack, { backgroundColor: colors.surfaceAlt }]}>
        <View style={[styles.statFill, { width: `${pct * 100}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

export default function BuddyScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useSession();
  const { open } = useSidebar();

  const [buddy, setBuddy] = useState<UserBuddy | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [anim, setAnim] = useState<BuddyAnimationState>('idle');
  const [speakingToken, setSpeakingToken] = useState<string | null>(null);
  const speaking = speakingToken !== null;
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const active = await ensureStarterBuddy(db, user.id);
      setBuddy(active);
      setAnim(active.mood === 'happy' ? 'happy' : active.mood === 'sleepy' ? 'sleeping' : 'idle');
    } catch (err) { console.warn('Failed to load buddy', err); }
    finally { setLoading(false); loadedRef.current = true; }
  }, [db, user]);

  useFocusEffect(useCallback(() => { if (!loadedRef.current) setLoading(true); void load(); }, [load]));

  const species = buddy ? getSpecies(buddy.speciesId) : undefined;
  const form = buddy ? getForm(buddy.currentFormId) : undefined;
  const personality = buddy ? getPersonality(buddy.speciesId) : undefined;
  const nextLevelXp = buddy ? xpForLevel(buddy.level) : 100;
  const prevLevelXp = buddy && buddy.level > 1 ? xpForLevel(buddy.level - 1) : 0;
  const xpPct = buddy ? Math.max(0, Math.min(1, (buddy.xp - prevLevelXp) / Math.max(1, nextLevelXp - prevLevelXp))) : 0;

  const runActivity = async (label: string, nextAnim: BuddyAnimationState, mood: UserBuddy['mood'], xp: number, bond: number, message: string) => {
    if (!user || !buddy || busy) return;
    setBusy(true);
    setAnim(nextAnim);
    try {
      await addXp(db, user.id, buddy.id, xp);
      await addBond(db, user.id, buddy.id, bond);
      await setBuddyMood(db, user.id, buddy.id, mood);
      await logBuddyActivity(db, user.id, buddy.id, label, xp, bond);
      await load();
      setAnim('celebrating');
      setTimeout(() => setAnim('idle'), 1400);
      Alert.alert(label, message);
    } finally { setBusy(false); }
  };

  const onVoice = () => {
    if (!buddy || !personality) return;
    const text = `${personality.greeting} I am feeling ${buddy.mood} today.`;
    const token = `${Date.now()}:${Math.random()}`;
    const finish = () => setSpeakingToken((current) => (current === token ? null : current));
    setSpeakingToken(null);
    Speech.stop();
    Speech.speak(text, {
      rate: 0.95,
      pitch: 1.0,
      // Only animate the mouth once the platform confirms speech actually started.
      onStart: () => {
        setSpeakingToken((current) => (current === null || current === token ? token : current));
        setAnim('speaking');
      },
      onDone: finish,
      onStopped: finish,
      onError: finish,
    });
  };

  if (loading) {
    return <View style={[styles.screen, { paddingTop: insets.top }]}><GlassBackdrop /><View style={styles.center}><ActivityIndicator color={colors.accent} /></View></View>;
  }
  if (!buddy || !species || !form) {
    return <View style={[styles.screen, { paddingTop: insets.top }]}><GlassBackdrop /><View style={styles.center}><Text style={styles.emptyText}>No buddy found.</Text></View></View>;
  }

  const displayName = buddy.nickname || form.name;

  return (
    <View style={styles.screen}>
      <GlassBackdrop />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + 120, paddingHorizontal: spacing.lg }} showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <SidebarButton onPress={open} />
          <Text style={styles.title}>Orbit Buddy</Text>
          <Pressable style={styles.iconBtn} onPress={() => router.navigate('/(app)/buddy/collection' as never)}>
            <Ionicons name="grid-outline" size={20} color={colors.text} />
          </Pressable>
        </View>

        <GlassView style={styles.heroCard}>
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.buddyName}>{displayName}</Text>
              <Text style={styles.buddyMeta}>{species.mbti} · {species.group} · {form.element}</Text>
              <Text style={styles.buddyDesc}>{form.description}</Text>
            </View>
            <View style={styles.levelBadge}><Text style={styles.levelText}>Lv {buddy.level}</Text></View>
          </View>

          <View style={styles.avatarWrap}>
            <BuddyAvatar speciesId={buddy.speciesId} formId={buddy.currentFormId} size={Math.min(280, Math.max(190, Math.floor(width - 96)))} state={anim} speaking={speaking} onStateChange={setAnim} />
          </View>

          <View style={styles.moodRow}>
            <View style={styles.moodChip}><Text style={styles.moodChipText}>Mood: {buddy.mood}</Text></View>
            <View style={styles.moodChip}><Text style={styles.moodChipText}>Bond: {buddy.bond}%</Text></View>
            <View style={styles.moodChip}><Text style={styles.moodChipText}>{form.rarity}</Text></View>
          </View>

          <View style={styles.xpBlock}>
            <View style={styles.xpRow}><Text style={styles.xpLabel}>XP Progress</Text><Text style={styles.xpValue}>{buddy.xp - prevLevelXp} / {nextLevelXp - prevLevelXp}</Text></View>
            <View style={styles.xpTrack}><View style={[styles.xpFill, { width: `${xpPct * 100}%` }]} /></View>
          </View>

          <View style={styles.statsGrid}>
            <StatBar label="POW" value={form.stats.power} color={colors.accent} />
            <StatBar label="INT" value={form.stats.intelligence} color={colors.blue} />
            <StatBar label="SPD" value={form.stats.speed} color={colors.success} />
            <StatBar label="AFF" value={form.stats.affinity} color={colors.warning} />
          </View>
        </GlassView>

        <GlassView style={styles.card}>
          <Text style={styles.sectionTitle}>Interact</Text>
          <View style={styles.actionsGrid}>
            {[
              { icon: 'chatbubble-ellipses-outline', label: 'Chat', onPress: () => router.navigate('/(app)/(tabs)/chat' as never) },
              { icon: 'mic-outline', label: 'Voice', onPress: onVoice },
              { icon: 'game-controller-outline', label: 'Play', onPress: () => void runActivity('Play', 'playing', 'happy', 12, 4, personality?.encouragement ?? 'That was fun!') },
              { icon: 'restaurant-outline', label: 'Feed', onPress: () => void runActivity('Feed', 'feeding', 'happy', 8, 3, 'Yum! Your buddy feels cared for.') },
              { icon: 'hand-left-outline', label: 'Pet', onPress: () => void runActivity('Pet', 'petting', 'calm', 6, 5, personality?.comfort ?? 'Your buddy feels close to you.') },
              { icon: 'barbell-outline', label: 'Train', onPress: () => void runActivity('Train', 'thinking', 'focused', 15, 2, 'Training complete. XP gained.') },
              { icon: 'sparkles-outline', label: 'Evolve', onPress: () => router.navigate(`/(app)/buddy/evolve?id=${buddy.id}` as never) },
              { icon: 'person-outline', label: 'Profile', onPress: () => router.navigate(`/(app)/buddy/tree?species=${buddy.speciesId}` as never) },
            ].map((a) => (
              <Pressable key={a.label} style={styles.actionBtn} onPress={a.onPress} disabled={busy}>
                <Ionicons name={a.icon as never} size={20} color={colors.accent} />
                <Text style={styles.actionLabel}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </GlassView>

        <GlassView style={styles.card}>
          <Text style={styles.sectionTitle}>Personality</Text>
          <Text style={styles.personalityLine}>{personality?.conversationStyle}</Text>
          <Text style={styles.personalityHint}>{`"${personality?.greeting ?? ""}"`}</Text>
          <View style={styles.traitRow}>
            {[
              ['INT', personality?.intelligence], ['FRI', personality?.friendliness], ['CUR', personality?.curiosity], ['PLY', personality?.playfulness],
            ].map(([k, v]) => (
              <View key={String(k)} style={styles.traitChip}><Text style={styles.traitText}>{k} {v}</Text></View>
            ))}
          </View>
        </GlassView>
      </ScrollView>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.textMuted, fontSize: 15 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  title: { color: colors.text, fontSize: 28, fontWeight: '700' },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  heroCard: { padding: spacing.lg, marginBottom: spacing.md },
  heroTop: { flexDirection: 'row', gap: spacing.md },
  buddyName: { color: colors.text, fontSize: 30, fontWeight: '700' },
  buddyMeta: { color: colors.accent, fontSize: 13, fontWeight: '600', marginTop: 2, textTransform: 'uppercase' },
  buddyDesc: { color: colors.textMuted, fontSize: 14, marginTop: 8, lineHeight: 20 },
  levelBadge: { backgroundColor: colors.accentSoft, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, alignSelf: 'flex-start' },
  levelText: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  avatarWrap: { alignItems: 'center', justifyContent: 'center', marginVertical: spacing.md },
  moodRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', marginBottom: spacing.md, flexWrap: 'wrap' },
  moodChip: { backgroundColor: colors.surfaceAlt, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  moodChipText: { color: colors.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  xpBlock: { marginBottom: spacing.md },
  xpRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  xpLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
  xpValue: { color: colors.textMuted, fontSize: 12 },
  xpTrack: { height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt, overflow: 'hidden' },
  xpFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 4 },
  statsGrid: { gap: 8 },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statLabel: { width: 36, color: colors.textMuted, fontSize: 11, fontWeight: '700' },
  statTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden' },
  statFill: { height: '100%', borderRadius: 4 },
  statValue: { width: 28, textAlign: 'right', color: colors.textMuted, fontSize: 11 },
  card: { padding: spacing.lg, marginBottom: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: '700', marginBottom: spacing.md },
  actionsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  actionBtn: { width: '31%', backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingVertical: 14, alignItems: 'center', gap: 6 },
  actionLabel: { color: colors.text, fontSize: 12, fontWeight: '600' },
  personalityLine: { color: colors.text, fontSize: 14, fontWeight: '600', marginBottom: 4, textTransform: 'capitalize' },
  personalityHint: { color: colors.textMuted, fontSize: 14, lineHeight: 20, marginBottom: spacing.md },
  traitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  traitChip: { backgroundColor: colors.surfaceAlt, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radius.pill },
  traitText: { color: colors.textMuted, fontSize: 12, fontWeight: '600' },
});
