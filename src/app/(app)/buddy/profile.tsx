import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { BuddyAvatar } from '@/components/buddy/BuddyAvatar';
import { BuddyDetailHeader } from '@/components/buddy/BuddyDetailHeader';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { useStyles, type AppTheme } from '@/context/theme';
import { useRouteBuddy } from '@/hooks/useRouteBuddy';
import { getBuddyCharacterProfile, getForm, getSpecies, xpForLevel } from '@/lib/buddy';
import { spacing } from '@/theme';

export default function BuddyProfileScreen() {
  const styles = useStyles(makeStyles);
  const { buddy, loading } = useRouteBuddy();

  const profile = buddy ? getBuddyCharacterProfile(buddy.speciesId) : null;
  const species = buddy ? getSpecies(buddy.speciesId) : null;
  const form = buddy ? getForm(buddy.currentFormId) : null;

  return (
    <View style={styles.root}>
      <GlassBackdrop />
      <BuddyDetailHeader title="Buddy Profile" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {loading || !buddy || !profile || !species || !form ? (
          <Text style={styles.empty}>Loading profile…</Text>
        ) : (
          <>
            <GlassView style={styles.hero}>
              <BuddyAvatar speciesId={buddy.speciesId} formId={buddy.currentFormId} size={112} interactive={false} />
              <View style={styles.heroCopy}>
                <Text style={styles.name}>{buddy.nickname || form.name}</Text>
                <Text style={styles.meta}>Character ID · {profile.characterId}</Text>
                <Text style={styles.meta}>{profile.mbti} · {profile.personalityGroup} · {profile.species}</Text>
                <Text style={styles.meta}>Level {buddy.level} · Bond {buddy.bond}% · {xpForLevel(buddy.level)} XP threshold</Text>
              </View>
            </GlassView>

            <GlassView style={styles.card}>
              <Text style={styles.section}>About</Text>
              <Text style={styles.body}>{profile.description}</Text>
              <Text style={styles.body}>Communication: {profile.communicationStyle}</Text>
            </GlassView>

            <GlassView style={styles.card}>
              <Text style={styles.section}>Attribute profile</Text>
              <Text style={styles.body}>
                {Object.entries(profile.attributes).map(([key, value]) => `${key}: ${value}/10`).join('\n')}
              </Text>
            </GlassView>

            <GlassView style={styles.card}>
              <Text style={styles.section}>Reaction language</Text>
              <Text style={styles.body}>Task done: {profile.reactionTemplates.task_completed[0]}</Text>
              <Text style={styles.body}>Setback: {profile.reactionTemplates.task_failed[0]}</Text>
              <Text style={styles.body}>Approval: {profile.reactionTemplates.approval_required[0]}</Text>
            </GlassView>

            <GlassView style={styles.card}>
              <Text style={styles.section}>Expression & animation map</Text>
              <Text style={styles.body}>
                {Object.entries(profile.animationMap).map(([event, animation]) => `${event} → ${animation}`).join('\n')}
              </Text>
            </GlassView>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
    empty: { color: colors.textMuted, fontSize: 14 },
    hero: { padding: spacing.md, flexDirection: 'row', gap: spacing.md, alignItems: 'center' },
    heroCopy: { flex: 1 },
    name: { color: colors.text, fontSize: 22, fontWeight: '700' },
    meta: { color: colors.textMuted, fontSize: 12, marginTop: 4 },
    card: { padding: spacing.md, gap: 8 },
    section: { color: colors.text, fontSize: 16, fontWeight: '700' },
    body: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  });
