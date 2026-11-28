import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { BuddyAvatar } from '@/components/buddy/BuddyAvatar';
import { BuddyDetailHeader } from '@/components/buddy/BuddyDetailHeader';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { useRouteBuddy } from '@/hooks/useRouteBuddy';
import {
  BUDDY_ACCESSORIES,
  getBuddyCustomization,
  setBuddyCustomization,
  setBuddyNickname,
  type BuddyAccessory,
} from '@/lib/buddy';
import { radius, spacing } from '@/theme';

export default function BuddyCustomizeScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { user } = useSession();
  const { buddy, loading } = useRouteBuddy();

  const [nickname, setNickname] = useState('');
  const [accessory, setAccessory] = useState<BuddyAccessory>('none');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user || !buddy) return;
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setNickname(buddy.nickname ?? '');
      try {
        const values = await getBuddyCustomization(db, user.id, buddy.id);
        if (cancelled) return;
        const value = values.accessory as BuddyAccessory | undefined;
        setAccessory(BUDDY_ACCESSORIES.some((item) => item.id === value) ? value! : 'none');
      } catch (error) {
        console.warn('Buddy customization could not load.', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [buddy, db, user]);

  async function save() {
    if (!user || !buddy || saving) return;
    setSaving(true);
    setStatus('');
    try {
      await setBuddyNickname(db, user.id, buddy.id, nickname);
      await setBuddyCustomization(db, user.id, buddy.id, 'accessory', accessory);
      setStatus('Saved locally.');
    } catch (error) {
      console.warn('Buddy customization could not be saved.', error);
      setStatus('Could not save preferences.');
    } finally {
      setSaving(false);
    }
  }

  if (loading || !buddy) {
    return (
      <View style={[styles.root, styles.centered]}>
        <GlassBackdrop />
        <BuddyDetailHeader title="Customize" />
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <GlassBackdrop />
      <BuddyDetailHeader title="Customize Buddy" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassView style={styles.preview}>
          <BuddyAvatar
            speciesId={buddy.speciesId}
            formId={buddy.currentFormId}
            size={150}
            state="happy"
            interactive={false}
            accessory={accessory}
          />
          <Text style={styles.previewName}>{nickname.trim() || 'Buddy'}</Text>
        </GlassView>

        <GlassView style={styles.card}>
          <Text style={styles.section}>Nickname</Text>
          <TextInput
            accessibilityLabel="Buddy nickname"
            maxLength={40}
            placeholder="Give your buddy a name"
            placeholderTextColor={colors.textFaint}
            style={styles.input}
            value={nickname}
            onChangeText={setNickname}
          />
        </GlassView>

        <GlassView style={styles.card}>
          <Text style={styles.section}>Accessory</Text>
          <Text style={styles.note}>Cosmetic only. Accessories never change stats, tools, permissions or Agent behavior.</Text>
          <View style={styles.accessories}>
            {BUDDY_ACCESSORIES.map((item) => (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityLabel={`Use ${item.label} accessory`}
                accessibilityState={{ selected: accessory === item.id }}
                onPress={() => setAccessory(item.id)}
                style={({ pressed }) => [
                  styles.chip,
                  accessory === item.id && styles.chipActive,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, accessory === item.id && styles.chipTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </GlassView>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save Buddy customization"
          disabled={saving}
          onPress={() => void save()}
          style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}
        >
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
        {status ? <Text style={styles.status}>{status}</Text> : null}
      </ScrollView>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.background },
    centered: { alignItems: 'center', justifyContent: 'center' },
    content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md, alignItems: 'stretch' },
    preview: { padding: spacing.lg, alignItems: 'center', gap: spacing.sm },
    previewName: { color: colors.text, fontSize: 18, fontWeight: '700' },
    card: { padding: spacing.md, gap: 10 },
    section: { color: colors.text, fontSize: 16, fontWeight: '700' },
    note: { color: colors.textFaint, fontSize: 11, lineHeight: 16 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      padding: spacing.sm,
      fontSize: 14,
    },
    accessories: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, backgroundColor: colors.surfaceAlt },
    chipActive: { backgroundColor: colors.accentSoft },
    chipText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: colors.accent },
    saveButton: { padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.accentStrong, alignItems: 'center' },
    saveText: { color: colors.onInverse, fontSize: 15, fontWeight: '700' },
    status: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },
    pressed: { opacity: 0.8 },
  });
