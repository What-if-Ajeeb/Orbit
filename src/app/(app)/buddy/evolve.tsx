import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
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

import { BuddyAvatar } from '@/components/buddy/BuddyAvatar';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  canEvolveTo,
  getForm,
  getInventory,
  getUserBuddy,
  tryEvolve,
  type UserBuddy,
} from '@/lib/buddy';
import { radius, spacing } from '@/theme';

export default function EvolveScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { id } = useLocalSearchParams<{ id: string }>();

  const [buddy, setBuddy] = useState<UserBuddy | null>(null);
  const [inventory, setInventory] = useState<{ itemId: string; quantity: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [evolving, setEvolving] = useState(false);

  const load = useCallback(async () => {
    if (!id || !user) return;
    try {
      setLoading(true);
      const [b, items] = await Promise.all([
        getUserBuddy(db, user.id, id),
        getInventory(db, user.id),
      ]);
      setBuddy(b);
      setInventory(items);
    } finally {
      setLoading(false);
    }
  }, [db, id, user]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleEvolve(targetFormId: string) {
    if (!buddy || evolving) return;
    const target = getForm(targetFormId);
    Alert.alert(
      'Confirm Evolution',
      `Evolve ${getForm(buddy.currentFormId)?.name ?? 'buddy'} into ${target?.name ?? 'this form'}? This only happens after your confirmation.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Evolve',
          onPress: async () => {
            setEvolving(true);
            try {
              const result = await tryEvolve(db, user!.id, buddy.id, targetFormId);
              if (result.ok && result.evolved) {
                Alert.alert('Evolution!', `${result.from.name} evolved into ${result.to.name}!`, [
                  { text: 'Awesome', onPress: () => { void load(); } },
                ]);
              } else if (result.ok) {
                Alert.alert('Cannot evolve', result.reason);
              } else {
                Alert.alert('Cannot evolve', result.error);
              }
            } catch {
              Alert.alert('Error', 'Something went wrong');
            } finally {
              setEvolving(false);
            }
          },
        },
      ],
    );
  }

  if (!user) return null;

  if (loading || !buddy) {
    return (
      <View style={[styles.root, styles.centered]}>
        <GlassBackdrop />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const currentForm = getForm(buddy.currentFormId);
  const nextIds = currentForm?.evolvesTo ?? [];

  return (
    <View style={styles.root}>
      <GlassBackdrop />

      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Evolution</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassView style={styles.currentCard}>
          <Text style={styles.sectionLabel}>CURRENT FORM</Text>
          <View style={styles.formRow}>
            <BuddyAvatar speciesId={buddy.speciesId} formId={buddy.currentFormId} size={88} interactive={false} />
            <View>
              <Text style={styles.formName}>{currentForm?.name ?? 'Unknown'}</Text>
              <Text style={styles.meta}>
                Lv.{buddy.level} · Bond {buddy.bond}%
              </Text>
            </View>
          </View>
        </GlassView>

        <Text style={styles.sectionTitle}>Available Paths</Text>

        {nextIds.length === 0 ? (
          <GlassView style={styles.empty}>
            <Text style={styles.emptyText}>This form has no further evolutions.</Text>
          </GlassView>
        ) : (
          nextIds.map((fid) => {
            const target = getForm(fid);
            if (!target) return null;

            const req = target.requirements;
            const levelOk = !req?.level || buddy.level >= req.level;
            const bondOk = !req?.bond || buddy.bond >= req.bond;
            const check = canEvolveTo(buddy, target, inventory);
            const ready = check.ok;

            return (
              <GlassView key={fid} style={styles.pathCard}>
                <View style={styles.pathHeader}>
                  <BuddyAvatar speciesId={buddy.speciesId} formId={target.id} size={72} interactive={false} state={ready ? 'happy' : 'idle'} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.formName}>{target.name}</Text>
                    <Text style={styles.meta}>
                      Stage {target.stage} · {target.rarity}
                    </Text>
                  </View>
                </View>

                {req ? (
                  <View style={styles.reqs}>
                    {req.level ? (
                      <Text style={[styles.req, !levelOk && styles.reqFail]}>
                        Level {req.level} {levelOk ? '✓' : `(now ${buddy.level})`}
                      </Text>
                    ) : null}
                    {req.bond ? (
                      <Text style={[styles.req, !bondOk && styles.reqFail]}>
                        Bond {req.bond}% {bondOk ? '✓' : `(now ${buddy.bond}%)`}
                      </Text>
                    ) : null}
                    {req.items?.map((item) => {
                      const have = inventory.find((entry) => entry.itemId === item.itemId)?.quantity ?? 0;
                      const itemOk = have >= item.quantity;
                      return (
                        <Text key={item.itemId} style={[styles.req, !itemOk && styles.reqFail]}>
                          {item.itemId} ×{item.quantity} {itemOk ? '✓' : `(have ${have})`}
                        </Text>
                      );
                    })}
                  </View>
                ) : null}

                <Pressable
                  style={({ pressed }) => [
                    styles.evolveBtn,
                    !ready && styles.evolveBtnDisabled,
                    pressed && styles.pressed,
                  ]}
                  disabled={!ready || evolving}
                  onPress={() => handleEvolve(fid)}
                >
                  <Text style={styles.evolveBtnText}>
                    {evolving ? 'Evolving...' : ready ? 'Evolve Now' : 'Requirements not met'}
                  </Text>
                </Pressable>
              </GlassView>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    centered: { alignItems: 'center', justifyContent: 'center' },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.sm,
    },
    backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
    title: { color: colors.text, fontSize: 18, fontWeight: '700' },
    content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
    currentCard: { padding: spacing.md, gap: spacing.sm },
    sectionLabel: {
      color: colors.textFaint,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.2,
    },
    formRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    formName: { color: colors.text, fontSize: 17, fontWeight: '700' },
    meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
    sectionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      marginTop: spacing.sm,
    },
    pathCard: { padding: spacing.md, gap: spacing.sm },
    pathHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
    reqs: { gap: 4 },
    req: { color: colors.success, fontSize: 13 },
    reqFail: { color: colors.textMuted },
    evolveBtn: {
      backgroundColor: colors.accentStrong,
      borderRadius: radius.md,
      minHeight: 46,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 4,
    },
    evolveBtnDisabled: { opacity: 0.45 },
    evolveBtnText: { color: colors.white, fontSize: 15, fontWeight: '600' },
    empty: { padding: spacing.lg, alignItems: 'center' },
    emptyText: { color: colors.textMuted, fontSize: 14 },
    pressed: { opacity: 0.85 },
  });
