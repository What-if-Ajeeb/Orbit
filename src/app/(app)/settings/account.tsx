import { CalendarDays, LockKeyhole, LogOut, Mail } from 'lucide-react-native';
import { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { GlassView } from '@/components/GlassView';
import { SettingsFeedback } from '@/components/settings/SettingsFeedback';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsScreen } from '@/components/settings/SettingsScreen';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { fonts, radius, spacing, typography } from '@/theme';

function initialsFor(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

function memberSince(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export default function AccountSettingsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const { user, signOut } = useSession();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) {
    return (
      <SettingsScreen
        title="Account Details"
        subtitle="Your local profile on this device."
      >
        <GlassView style={styles.profile}>
          <View style={styles.profileCopy}>
            <Text style={styles.name}>No active account</Text>
            <Text style={styles.email}>Sign in again to view your profile.</Text>
          </View>
        </GlassView>
      </SettingsScreen>
    );
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'Your local account stays on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setSigningOut(true);
            setError(null);

            try {
              await signOut();
            } catch {
              setError('Could not sign out. Please try again.');
              setSigningOut(false);
            }
          })();
        },
      },
    ]);
  }

  return (
    <SettingsScreen
      title="Account Details"
      subtitle="Your local profile on this device. ORBIT keeps one active local account at a time."
    >
      <SettingsFeedback error={error} onDismissError={() => setError(null)} />

      <GlassView style={styles.profile}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initialsFor(user.name)}</Text>
        </View>
        <View style={styles.profileCopy}>
          <Text numberOfLines={1} style={styles.name}>
            {user.name}
          </Text>
          <Text numberOfLines={1} style={styles.email}>
            {user.email}
          </Text>
        </View>
        <View style={styles.badge}>
          <Text style={styles.badgeText}>Local</Text>
        </View>
      </GlassView>

      <SettingsGroup title="Profile">
        <SettingsRow
          icon={Mail}
          title="Email"
          value={user.email}
          showChevron={false}
        />
        <SettingsRow
          icon={CalendarDays}
          title="Member since"
          value={memberSince(user.createdAt)}
          showChevron={false}
        />
        <SettingsRow
          icon={LockKeyhole}
          title="Account storage"
          description="The account and session are stored on this device. Signing out does not delete chats or tasks."
          showChevron={false}
        />
      </SettingsGroup>

      <GlassView style={styles.sessionCard}>
        <View style={styles.sessionCopy}>
          <Text style={styles.sessionTitle}>Session</Text>
          <Text style={styles.sessionDescription}>
            Signing out ends this session. You can sign back in with the same local account.
          </Text>
        </View>
        <Button
          label="Sign out"
          variant="danger"
          onPress={confirmSignOut}
          loading={signingOut}
        />
      </GlassView>

      <View style={styles.noteRow}>
        <LogOut size={15} color={colors.textFaint} strokeWidth={2} />
        <Text style={styles.note}>
          The AI provider configuration is stored separately and is not removed by signing out.
        </Text>
      </View>
    </SettingsScreen>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    profile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
    },
    avatar: {
      width: 54,
      height: 54,
      borderRadius: 27,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    avatarText: {
      color: colors.accent,
      fontFamily: fonts.serif,
      fontSize: 21,
      fontWeight: '700',
    },
    profileCopy: {
      flex: 1,
      gap: 2,
    },
    name: {
      color: colors.text,
      ...typography.section,
    },
    email: {
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    badge: {
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    badgeText: {
      color: colors.textMuted,
      ...typography.caption,
      fontSize: 11,
      fontWeight: '600',
    },
    sessionCard: {
      padding: spacing.md,
      gap: spacing.md,
    },
    sessionCopy: {
      gap: 4,
    },
    sessionTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    sessionDescription: {
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    noteRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    note: {
      flex: 1,
      color: colors.textFaint,
      ...typography.caption,
    },
  });
