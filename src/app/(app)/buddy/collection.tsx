import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackdrop } from '@/components/GlassBackdrop';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  ALL_SPECIES_IDS,
  getForm,
  getSpecies,
  listUserBuddies,
  type UserBuddy,
} from '@/lib/buddy';
import { radius, spacing } from '@/theme';

type Filter = 'all' | 'owned' | 'shiny' | 'mythical';

export default function BuddyCollectionScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();

  const [owned, setOwned] = useState<UserBuddy[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setLoading(true);
      const list = await listUserBuddies(db, user.id);
      setOwned(list);
    } finally {
      setLoading(false);
    }
  }, [db, user]);

  useEffect(() => {
    void load();
  }, [load]);

  const ownedMap = new Map(owned.map((b) => [b.speciesId, b]));

  const items = ALL_SPECIES_IDS.filter((id) => {
    if (filter === 'owned') return ownedMap.has(id);
    if (filter === 'shiny' || filter === 'mythical') {
      // For Phase 2 we only show owned that have matching rarity forms unlocked
      const ub = ownedMap.get(id);
      if (!ub) return false;
      return ub.unlockedForms.some((fid) => {
        const f = getForm(fid);
        return f?.rarity === filter;
      });
    }
    return true;
  });

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
        {(['all', 'owned', 'shiny', 'mythical'] as Filter[]).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            style={[styles.filterChip, filter === f && styles.filterChipActive]}
          >
            <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
              {f === 'all' ? `All (${ALL_SPECIES_IDS.length})` : f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(id) => id}
          numColumns={3}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.row}
          renderItem={({ item: speciesId }) => {
            const species = getSpecies(speciesId)!;
            const ub = ownedMap.get(speciesId);
            const form = ub ? getForm(ub.currentFormId) : getForm(species.baseFormId);
            const ownedFlag = !!ub;

            return (
              <Pressable
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
                onPress={() => {
                  if (ub) {
                    // Could navigate to detail later
                  }
                }}
              >
                <View style={[styles.avatar, !ownedFlag && styles.avatarLocked]}>
                  <Ionicons
                    name={ownedFlag ? 'paw' : 'lock-closed'}
                    size={28}
                    color={ownedFlag ? colors.accent : colors.textFaint}
                  />
                </View>
                <Text style={[styles.cardName, !ownedFlag && styles.lockedText]} numberOfLines={1}>
                  {form?.name ?? species.name}
                </Text>
                {ownedFlag ? (
                  <Text style={styles.cardLevel}>Lv.{ub.level}</Text>
                ) : (
                  <Text style={styles.lockedLabel}>Locked</Text>
                )}
              </Pressable>
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
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    title: { color: colors.text, fontSize: 18, fontWeight: '700' },
    filters: {
      flexDirection: 'row',
      gap: 8,
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.md,
      flexWrap: 'wrap',
    },
    filterChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
    },
    filterChipActive: { backgroundColor: colors.accentSoft },
    filterText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
    filterTextActive: { color: colors.accent },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    grid: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
    row: { gap: spacing.sm, marginBottom: spacing.sm },
    card: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.sm,
      alignItems: 'center',
      gap: 4,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    avatarLocked: { backgroundColor: colors.surfaceAlt },
    cardName: { color: colors.text, fontSize: 12, fontWeight: '600', textAlign: 'center' },
    cardLevel: { color: colors.accent, fontSize: 11, fontWeight: '700' },
    lockedText: { color: colors.textFaint },
    lockedLabel: { color: colors.textFaint, fontSize: 11 },
    pressed: { opacity: 0.8 },
  });
