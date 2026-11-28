import Ionicons from '@expo/vector-icons/Ionicons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { getSpecies, type BuddyForm } from '@/lib/buddy';
import { radius, spacing } from '@/theme';

function FormNode({ form, isRoot }: { form: BuddyForm; isRoot?: boolean }) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={[styles.node, isRoot && styles.rootNode]}>
      <View style={styles.nodeAvatar}>
        <Ionicons name="paw" size={22} color={colors.accent} />
      </View>
      <Text style={styles.nodeName}>{form.name}</Text>
      <Text style={styles.nodeMeta}>
        Stage {form.stage} · {form.rarity}
      </Text>
      {form.requirements ? (
        <Text style={styles.nodeReq}>
          {form.requirements.level ? `Lv.${form.requirements.level}` : ''}
          {form.requirements.bond ? ` · Bond ${form.requirements.bond}%` : ''}
          {form.requirements.tasksCompleted ? ` · ${form.requirements.tasksCompleted} tasks` : ''}
          {form.requirements.items?.length
            ? ` · ${form.requirements.items.map((item) => `${item.itemId} ×${item.quantity}`).join(', ')}`
            : ''}
        </Text>
      ) : null}
    </View>
  );
}

export default function EvolutionTreeScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { speciesId } = useLocalSearchParams<{ speciesId: string }>();

  const species = getSpecies(speciesId || 'fox');

  if (!species) {
    return (
      <View style={[styles.root, styles.centered]}>
        <Text style={{ color: colors.text }}>Species not found</Text>
      </View>
    );
  }

  const base = species.forms.find((f) => f.isDefault) || species.forms[0];
  const others = species.forms.filter((f) => f.id !== base.id);

  return (
    <View style={styles.root}>
      <GlassBackdrop />

      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={22} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>{species.name} Tree</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.subtitle}>{species.description}</Text>

        <FormNode form={base} isRoot />

        {others.length > 0 ? (
          <>
            <View style={styles.connector} />
            <View style={styles.branchRow}>
              {others.map((form) => (
                <FormNode key={form.id} form={form} />
              ))}
            </View>
          </>
        ) : null}

        <GlassView style={styles.infoCard}>
          <Text style={styles.infoTitle}>How evolution works</Text>
          <Text style={styles.infoText}>
            Raise your buddy’s level by completing tasks and chatting. Increase bond by interacting.
            When requirements are met, open the Evolve screen and choose a path.
          </Text>
        </GlassView>
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
    content: { padding: spacing.lg, paddingBottom: spacing.xl, alignItems: 'center', gap: spacing.md },
    subtitle: { color: colors.textMuted, fontSize: 14, textAlign: 'center', marginBottom: spacing.sm },
    node: {
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      alignItems: 'center',
      minWidth: 140,
      gap: 4,
    },
    rootNode: { borderColor: colors.accent, borderWidth: 2 },
    nodeAvatar: {
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 4,
    },
    nodeName: { color: colors.text, fontSize: 15, fontWeight: '700' },
    nodeMeta: { color: colors.textMuted, fontSize: 12 },
    nodeReq: { color: colors.accent, fontSize: 11, fontWeight: '600', marginTop: 2 },
    connector: {
      width: 2,
      height: 24,
      backgroundColor: colors.border,
    },
    branchRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    infoCard: { marginTop: spacing.lg, padding: spacing.md, width: '100%', gap: 6 },
    infoTitle: { color: colors.text, fontSize: 15, fontWeight: '600' },
    infoText: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  });
