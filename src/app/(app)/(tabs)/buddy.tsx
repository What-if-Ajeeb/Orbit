import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { SidebarButton } from '@/components/SidebarButton';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  addBond,
  addXp,
  ensureStarterBuddy,
  getForm,
  getSpecies,
  listUserBuddies,
  type UserBuddy,
  xpForLevel,
} from '@/lib/buddy';
import { radius, spacing } from '@/theme';

function StatBar({
  label,
  value,
  max = 100,
  color,
}: {
  label: string;
  value: number;
  max?: number;
  color: string;
}) {
  const styles = useStyles(makeStyles);
  const pct = Math.min(100, Math.round((value / max) * 100));

  return (
    <View style={styles.statBarRow}>
      <Text style={styles.statBarLabel}>{label}</Text>
      <View style={styles.statBarTrack}>
        <View style={[styles.statBarFill, { width: `${pct}%`, backgroundColor: color }]} />
      </View>
      <Text style={styles.statBarValue}>{value}</Text>
    </View>
  );
}

export default function BuddyScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();

  const [buddy, setBuddy] = useState<UserBuddy | null>(null);
  const [collectionCount, setCollectionCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [interacting, setInteracting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const prevLevelRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    if (!user) return;

    try {
      setLoading(true);
      const active = await ensureStarterBuddy(db, user.id);
      const all = await listUserBuddies(db, user.id);
      setBuddy(active);
      setCollectionCount(all.length);

      if (prevLevelRef.current !== null && active.level > prevLevelRef.current) {
        setBanner(`Level up! ${prevLevelRef.current} → ${active.level}`);
        setTimeout(() => setBanner(null), 3500);
      }
      prevLevelRef.current = active.level;
    } catch (err) {
      console.warn('Failed to load buddy', err);
    } finally {
      setLoading(false);
    }
  }, [db, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  async function handleInteract() {
    if (!buddy || interacting) return;
    setInteracting(true);
    try {
      const before = buddy.level;
      await addXp(db, buddy.id, 12);
      await addBond(db, buddy.id, 2);
      await load();
      setBanner(before < (buddy.level + 1) ? 'Nice! +12 XP · +2 Bond' : '+12 XP · +2 Bond');
      setTimeout(() => setBanner(null), 2500);
    } catch {
      Alert.alert('Oops', 'Could not train buddy right now.');
    } finally {
      setInteracting(false);
    }
  }

  if (!user) return null;

  if (loading || !buddy) {
    return (
      <View style={[styles.root, styles.centered]}>
        <GlassBackdrop />
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  const species = getSpecies(buddy.speciesId);
  const form = getForm(buddy.currentFormId);
  const displayName = buddy.nickname || form?.name || species?.name || 'Buddy';
  const nextXp = xpForLevel(buddy.level);
  const xpProgress = Math.min(1, buddy.xp / nextXp);

  const canEvolve =
    form?.evolvesTo &&
    form.evolvesTo.length > 0 &&
    form.evolvesTo.some((nextId) => {
      const next = getForm(nextId);
      if (!next?.requirements) return true;
      const req = next.requirements;
      if (req.level && buddy.level < req.level) return false;
      if (req.bond && buddy.bond < req.bond) return false;
      return true;
    });

  const nearEvolve =
    !canEvolve &&
    form?.evolvesTo?.some((nextId) => {
      const next = getForm(nextId);
      if (!next?.requirements) return false;
      const req = next.requirements;
      const levelClose = req.level ? buddy.level >= req.level - 2 : true;
      const bondClose = req.bond ? buddy.bond >= req.bond - 15 : true;
      return levelClose && bondClose;
    });

  return (
    <View style={styles.root}>
      <GlassBackdrop />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <SidebarButton onPress={openSidebar} />
            <Text style={styles.wordmark}>ORBIT Buddy</Text>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/buddy/collection')}
            style={styles.collectionChip}
          >
            <Ionicons name="grid-outline" size={16} color={colors.accent} />
            <Text style={styles.collectionChipText}>{collectionCount}</Text>
          </Pressable>
        </View>

        {banner ? (
          <View style={styles.banner}>
            <Ionicons name="sparkles" size={16} color={colors.accent} />
            <Text style={styles.bannerText}>{banner}</Text>
          </View>
        ) : null}

        <GlassView style={styles.heroCard}>
          <View style={styles.heroHeader}>
            <View style={styles.avatarPlaceholder}>
              <Ionicons name="paw" size={48} color={colors.accent} />
              {canEvolve ? (
                <View style={styles.readyBadge}>
                  <Ionicons name="flash" size={12} color={colors.white} />
                </View>
              ) : null}
            </View>
            <View style={styles.heroInfo}>
              <View style={styles.nameRow}>
                <Text style={styles.buddyName}>{displayName}</Text>
                {species?.mbti ? (
                  <View style={styles.mbtiChip}>
                    <Text style={styles.mbtiText}>{species.mbti}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.formName}>{form?.name ?? 'Base Form'}</Text>
              <View style={styles.levelRow}>
                <Text style={styles.levelText}>Lv. {buddy.level}</Text>
                {form?.rarity && form.rarity !== 'common' ? (
                  <View style={styles.rarityChip}>
                    <Text style={styles.rarityText}>{form.rarity}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          </View>

          {nearEvolve ? (
            <View style={styles.hintRow}>
              <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
              <Text style={styles.hintText}>Almost ready to evolve — keep training!</Text>
            </View>
          ) : null}

          <View style={styles.xpSection}>
            <View style={styles.xpHeader}>
              <Text style={styles.xpLabel}>XP</Text>
              <Text style={styles.xpNumbers}>
                {buddy.xp} / {nextXp}
              </Text>
            </View>
            <View style={styles.xpTrack}>
              <View style={[styles.xpFill, { width: `${xpProgress * 100}%` }]} />
            </View>
          </View>

          <View style={styles.bondRow}>
            <Ionicons name="heart" size={16} color="#ff6b8a" />
            <Text style={styles.bondLabel}>Bond</Text>
            <View style={styles.bondTrack}>
              <View
                style={[
                  styles.bondFill,
                  { width: `${buddy.bond}%`, backgroundColor: '#ff6b8a' },
                ]}
              />
            </View>
            <Text style={styles.bondValue}>{buddy.bond}%</Text>
          </View>

          {form ? (
            <View style={styles.statsBlock}>
              <StatBar label="Power" value={form.stats.power} color={colors.accent} />
              <StatBar label="Intelligence" value={form.stats.intelligence} color="#7c9cff" />
              <StatBar label="Speed" value={form.stats.speed} color="#5eead4" />
              <StatBar label="Affinity" value={form.stats.affinity} color="#c084fc" />
            </View>
          ) : null}

          <View style={styles.actionRow}>
            <Pressable
              style={({ pressed }) => [styles.actionBtn, styles.secondaryBtn, pressed && styles.pressed]}
              onPress={() => router.push('/chat')}
            >
              <Ionicons name="chatbubble-outline" size={18} color={colors.text} />
              <Text style={styles.secondaryBtnText}>Chat</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                styles.trainBtn,
                interacting && styles.disabledBtn,
                pressed && styles.pressed,
              ]}
              disabled={interacting}
              onPress={handleInteract}
            >
              <Ionicons name="fitness-outline" size={18} color={colors.text} />
              <Text style={styles.secondaryBtnText}>{interacting ? '...' : 'Train'}</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.actionBtn,
                styles.primaryBtn,
                !canEvolve && styles.disabledBtn,
                pressed && styles.pressed,
              ]}
              disabled={!canEvolve}
              onPress={() =>
                router.push({ pathname: '/buddy/evolve', params: { id: buddy.id } })
              }
            >
              <Ionicons name="flash" size={18} color={colors.white} />
              <Text style={styles.primaryBtnText}>
                {canEvolve ? 'Evolve' : 'Locked'}
              </Text>
            </Pressable>
          </View>
        </GlassView>

        <View style={styles.quickRow}>
          <Pressable
            style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}
            onPress={() => router.push('/buddy/collection')}
          >
            <Ionicons name="albums-outline" size={22} color={colors.accent} />
            <Text style={styles.quickTitle}>Collection</Text>
            <Text style={styles.quickSub}>{collectionCount} buddies</Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [styles.quickCard, pressed && styles.pressed]}
            onPress={() =>
              router.push({ pathname: '/buddy/tree', params: { speciesId: buddy.speciesId } })
            }
          >
            <Ionicons name="git-network-outline" size={22} color={colors.accent} />
            <Text style={styles.quickTitle}>Evolution Tree</Text>
            <Text style={styles.quickSub}>View paths</Text>
          </Pressable>
        </View>

        {form?.description ? (
          <GlassView style={styles.descCard}>
            <Text style={styles.descTitle}>About {displayName}</Text>
            <Text style={styles.descText}>{form.description}</Text>
          </GlassView>
        ) : null}

        <Text style={styles.tip}>
          Tip: Complete tasks & chat with the agent to earn XP and bond automatically.
        </Text>
      </ScrollView>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    centered: { alignItems: 'center', justifyContent: 'center' },
    content: { flexGrow: 1, paddingHorizontal: spacing.lg },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.md,
    },
    brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
    wordmark: { color: colors.text, fontSize: 17, fontWeight: '700', letterSpacing: 0.5 },
    collectionChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.accentSoft,
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
    },
    collectionChipText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.accentSoft,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: 10,
      marginBottom: spacing.sm,
    },
    bannerText: { color: colors.accent, fontSize: 14, fontWeight: '600', flex: 1 },
    heroCard: { padding: spacing.lg, gap: spacing.md },
    heroHeader: { flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
    avatarPlaceholder: {
      width: 88,
      height: 88,
      borderRadius: 44,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: colors.accent,
    },
    readyBadge: {
      position: 'absolute',
      right: -2,
      bottom: -2,
      width: 24,
      height: 24,
      borderRadius: 12,
      backgroundColor: colors.accentStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroInfo: { flex: 1, gap: 4 },
    nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    buddyName: { color: colors.text, fontSize: 22, fontWeight: '700' },
    mbtiChip: {
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.sm,
    },
    mbtiText: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },
    formName: { color: colors.textMuted, fontSize: 14 },
    levelRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    levelText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    rarityChip: {
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: radius.sm,
    },
    rarityText: { color: colors.textMuted, fontSize: 11, fontWeight: '700', textTransform: 'capitalize' },
    hintRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.accentSoft,
      borderRadius: radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    hintText: { color: colors.accent, fontSize: 12, fontWeight: '500', flex: 1 },
    xpSection: { gap: 6 },
    xpHeader: { flexDirection: 'row', justifyContent: 'space-between' },
    xpLabel: { color: colors.textFaint, fontSize: 12, fontWeight: '600' },
    xpNumbers: { color: colors.textMuted, fontSize: 12 },
    xpTrack: {
      height: 8,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 4,
      overflow: 'hidden',
    },
    xpFill: { height: '100%', backgroundColor: colors.accent, borderRadius: 4 },
    bondRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    bondLabel: { color: colors.textFaint, fontSize: 12, fontWeight: '600', width: 36 },
    bondTrack: {
      flex: 1,
      height: 6,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 3,
      overflow: 'hidden',
    },
    bondFill: { height: '100%', borderRadius: 3 },
    bondValue: { color: colors.textMuted, fontSize: 12, width: 36, textAlign: 'right' },
    statsBlock: { gap: 8, marginTop: 4 },
    statBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    statBarLabel: { color: colors.textFaint, fontSize: 12, width: 80 },
    statBarTrack: {
      flex: 1,
      height: 6,
      backgroundColor: colors.surfaceAlt,
      borderRadius: 3,
      overflow: 'hidden',
    },
    statBarFill: { height: '100%', borderRadius: 3 },
    statBarValue: { color: colors.textMuted, fontSize: 12, width: 28, textAlign: 'right' },
    actionRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
    actionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 46,
      borderRadius: radius.md,
    },
    primaryBtn: { backgroundColor: colors.accentStrong },
    secondaryBtn: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    trainBtn: {
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    disabledBtn: { opacity: 0.5 },
    primaryBtnText: { color: colors.white, fontSize: 14, fontWeight: '600' },
    secondaryBtnText: { color: colors.text, fontSize: 14, fontWeight: '600' },
    pressed: { opacity: 0.8 },
    quickRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
    quickCard: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      gap: 4,
    },
    quickTitle: { color: colors.text, fontSize: 14, fontWeight: '600', marginTop: 4 },
    quickSub: { color: colors.textFaint, fontSize: 12 },
    descCard: { marginTop: spacing.md, padding: spacing.md, gap: 6 },
    descTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    descText: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
    tip: {
      color: colors.textFaint,
      fontSize: 12,
      textAlign: 'center',
      marginTop: spacing.lg,
      lineHeight: 18,
    },
  });
