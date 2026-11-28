import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BuddyAvatar } from '@/components/buddy/BuddyAvatar';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  ALL_SPECIES_IDS,
  claimUnlockedCharacter,
  ensureStarterBuddy,
  evaluateBuddyProgress,
  getForm,
  getSpecies,
  listCharacterUnlocks,
  listUserBuddies,
  type BuddyCharacterUnlockRecord,
  type UserBuddy,
} from '@/lib/buddy';
import { radius, spacing } from '@/theme';

type Filter = 'all' | 'owned' | 'unlocked' | 'shiny' | 'mythical';

export default function BuddyCollectionScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();

  const [owned, setOwned] = useState<UserBuddy[]>([]);
  const [unlocks, setUnlocks] = useState<BuddyCharacterUnlockRecord[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [claiming, setClaiming] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const active = await ensureStarterBuddy(db, user.id);
      await evaluateBuddyProgress(db, user.id, active);
      const [list, unlockRecords] = await Promise.all([
        listUserBuddies(db, user.id),
        listCharacterUnlocks(db, user.id),
      ]);
      setOwned(list);
      setUnlocks(unlockRecords);
      setSelected((prev) => prev ?? list.find((b) => b.isActive)?.speciesId ?? list[0]?.speciesId ?? null);
    } catch (err) {
      console.warn('Failed to load buddy collection', err);
    } finally {
      setLoading(false);
    }
  }, [db, user]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const ownedMap = useMemo(() => new Map(owned.map((b) => [b.speciesId, b])), [owned]);
  const unlockMap = useMemo(
    () => new Map(unlocks.map((unlock) => [unlock.speciesId, unlock])),
    [unlocks]
  );

  const items = ALL_SPECIES_IDS.filter((id) => {
    const ub = ownedMap.get(id);
    const unlocked = unlockMap.get(id)?.unlockedAt !== null && unlockMap.get(id)?.unlockedAt !== undefined;
    if (filter === 'owned') return !!ub;
    if (filter === 'unlocked') return unlocked;
    if (filter === 'shiny') return !!ub?.unlockedForms.some((fid) => getForm(fid)?.rarity === 'shiny');
    if (filter === 'mythical') return !!ub?.unlockedForms.some((fid) => getForm(fid)?.rarity === 'mythical');
    return true;
  });

  async function claim(speciesId: string) {
    if (!user || claiming) return;
    setClaiming(speciesId);
    try {
      const created = await claimUnlockedCharacter(db, user.id, speciesId);
      if (created) await load();
    } catch (error) {
      console.warn('Buddy unlock could not be claimed.', error);
    } finally {
      setClaiming(null);
    }
  }

  if (!user) return null;

  return (
    <View style={styles.root}>
      <GlassBackdrop />
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Buddy Collection</Text>
        <View style={{ width: 40 }} />
      </View>

      <View style={styles.filters}>
        {(['all', 'owned', 'unlocked', 'shiny', 'mythical'] as Filter[]).map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filterChip, filter === f && styles.filterChipActive]}>
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'all' ? `All (${ALL_SPECIES_IDS.length})` : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(id) => id}
          numColumns={2}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          renderItem={({ item: speciesId }) => {
            const species = getSpecies(speciesId);
            if (!species) return null;
            const ub = ownedMap.get(speciesId);
            const unlock = unlockMap.get(speciesId);
            const unlocked = unlock?.unlockedAt != null;
            const defaultForm = species.forms.find((f) => f.isDefault) ?? species.forms[0];
            const form = ub ? getForm(ub.currentFormId) ?? defaultForm : defaultForm;
            const isSelected = selected === speciesId;

            return (
              <View style={[styles.card, isSelected && styles.cardSelected]}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${species.name}`}
                  onPress={() => setSelected(speciesId)}
                  style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
                >
                  <View style={[styles.avatarWrap, !ub && styles.avatarLocked]}>
                    <BuddyAvatar speciesId={speciesId} formId={form?.id} size={96} interactive={false} />
                    {!ub ? <View style={styles.lockOverlay}><Ionicons name="lock-closed" size={18} color="#fff" /></View> : null}
                  </View>
                  <Text style={[styles.cardName, !ub && styles.lockedText]} numberOfLines={1}>{form?.name ?? species.name}</Text>
                  <Text style={styles.cardMeta} numberOfLines={1}>{species.mbti} · {species.group}</Text>
                </Pressable>

                {ub ? (
                  <>
                    <Text style={styles.cardLevel}>Lv.{ub.level} · Bond {ub.bond}%</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${species.name} profile`}
                      onPress={() => router.navigate(`/(app)/buddy/profile?id=${ub.id}` as never)}
                      style={styles.miniButton}
                    >
                      <Text style={styles.miniButtonText}>Profile</Text>
                    </Pressable>
                  </>
                ) : unlocked ? (
                  <>
                    <Text style={styles.unlockedLabel}>Unlocked</Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Claim ${species.name}`}
                      disabled={claiming !== null}
                      onPress={() => void claim(speciesId)}
                      style={styles.miniButton}
                    >
                      <Text style={styles.miniButtonText}>{claiming === speciesId ? 'Claiming…' : 'Claim'}</Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.lockedLabel}>{unlock?.reason ?? 'Progression unlock'}</Text>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    title: { color: colors.text, fontSize: 18, fontWeight: '700' },
    filters: { flexDirection: 'row', gap: 8, paddingHorizontal: spacing.lg, marginBottom: spacing.md, flexWrap: 'wrap' },
    filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
    filterChipActive: { backgroundColor: colors.accentSoft },
    filterText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
    filterTextActive: { color: colors.accent },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    grid: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
    row: { gap: spacing.sm, marginBottom: spacing.sm },
    card: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, alignItems: 'center', gap: 3, minHeight: 220 },
    cardSelected: { borderColor: colors.accent, backgroundColor: colors.accentSoft },
    cardMain: { alignItems: 'center', gap: 2 },
    avatarWrap: { width: 104, height: 104, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
    avatarLocked: { opacity: 0.45 },
    lockOverlay: { position: 'absolute', right: 8, bottom: 8, width: 28, height: 28, borderRadius: 14, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
    cardName: { color: colors.text, fontSize: 13, fontWeight: '700', textAlign: 'center' },
    cardMeta: { color: colors.textMuted, fontSize: 11, textAlign: 'center' },
    cardLevel: { color: colors.accent, fontSize: 11, fontWeight: '700', marginTop: 2 },
    unlockedLabel: { color: colors.success, fontSize: 11, fontWeight: '700', marginTop: 2 },
    lockedText: { color: colors.textMuted },
    lockedLabel: { color: colors.textFaint, fontSize: 10, textAlign: 'center', marginTop: 2 },
    miniButton: { marginTop: 4, paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.pill, backgroundColor: colors.accentSoft },
    miniButtonText: { color: colors.accent, fontSize: 11, fontWeight: '700' },
    pressed: { opacity: 0.85 },
  });
