import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Brand } from '@/components/Brand';
import { Button } from '@/components/Button';
import { useSession } from '@/context/auth';
import { colors, radius, spacing } from '@/theme';

function getGreeting(): string {
  const hour = new Date().getHours();

  if (hour < 12) {
    return 'Good morning';
  }

  if (hour < 17) {
    return 'Good afternoon';
  }

  return 'Good evening';
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function InfoRow({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.infoRow, !last && styles.infoRowBorder]}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

export default function HomeScreen() {
  const { user, signOut } = useSession();
  const insets = useSafeAreaInsets();
  const [isSigningOut, setIsSigningOut] = useState(false);

  if (!user) {
    return null;
  }

  const firstName = user.name.split(/\s+/)[0] ?? user.name;
  const initials = getInitials(user.name);

  async function handleSignOut() {
    setIsSigningOut(true);

    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  }

  function confirmSignOut() {
    Alert.alert(
      'Sign out?',
      'You can sign back in anytime. Your local account stays on this device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign out',
          style: 'destructive',
          onPress: () => {
            void handleSignOut();
          },
        },
      ]
    );
  }

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.glow} />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.brandRow}>
            <Brand size={40} />
            <Text style={styles.wordmark}>ORBIT</Text>
          </View>

          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials || 'O'}</Text>
          </View>
        </View>

        <Text style={styles.greeting}>
          {getGreeting()}, {firstName}
        </Text>
        <Text style={styles.subGreeting}>Your local space is ready.</Text>

        <View style={styles.card}>
          <View style={styles.statusHeader}>
            <View style={styles.statusDot} />
            <Text style={styles.statusTitle}>Local backend active</Text>
            <View style={styles.chip}>
              <Text style={styles.chipText}>SQLITE</Text>
            </View>
          </View>

          <Text style={styles.cardCaption}>
            Accounts and sessions live on this device. No server, no cloud.
          </Text>

          <View style={styles.infoList}>
            <InfoRow label="Database" value="orbit.db" />
            <InfoRow label="Sessions" value="30 days · encrypted" />
            <InfoRow label="Network" value="Not required" last />
          </View>
        </View>

        <Text style={styles.sectionLabel}>ACCOUNT</Text>

        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.profileAvatar}>
              <Text style={styles.profileAvatarText}>{initials || 'O'}</Text>
            </View>
            <View style={styles.profileText}>
              <Text style={styles.profileName}>{user.name}</Text>
              <Text style={styles.profileEmail}>{user.email}</Text>
            </View>
          </View>

          <View style={styles.infoList}>
            <InfoRow label="Member since" value={formatDate(user.createdAt)} />
            <InfoRow label="Sign-in" value="Email + password" last />
          </View>
        </View>

        <Text style={styles.sectionLabel}>NEXT STEP</Text>

        <View style={styles.card}>
          <Text style={styles.nextTitle}>Build your idea here</Text>
          <Text style={styles.nextText}>
            Add your first feature in{' '}
            <Text style={styles.code}>src/app/(app)/index.tsx</Text>. New screens become routes
            automatically.
          </Text>
        </View>

        <Button
          label="Sign out"
          onPress={confirmSignOut}
          variant="danger"
          loading={isSigningOut}
          style={styles.signOutButton}
        />

        <Text style={styles.footer}>Orbit v1.0.0 · Android · local-first</Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
  },
  glow: {
    position: 'absolute',
    top: -180,
    right: -120,
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: colors.accentSoft,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  wordmark: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 4,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: colors.accent,
    fontSize: 14,
    fontWeight: '700',
  },
  greeting: {
    color: colors.text,
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.6,
    marginTop: spacing.xl,
  },
  subGreeting: {
    color: colors.textMuted,
    fontSize: 15,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    marginTop: spacing.lg,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: colors.success,
  },
  statusTitle: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  chip: {
    backgroundColor: colors.successSoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  chipText: {
    color: colors.success,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  cardCaption: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  infoList: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: spacing.sm + 2,
  },
  infoRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  infoLabel: {
    color: colors.textMuted,
    fontSize: 14,
  },
  infoValue: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  profileAvatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(109, 139, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    color: colors.accent,
    fontSize: 17,
    fontWeight: '700',
  },
  profileText: {
    flex: 1,
  },
  profileName: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  profileEmail: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 2,
  },
  nextTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  nextText: {
    color: colors.textMuted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.xs,
  },
  code: {
    color: colors.accent,
    fontFamily: 'monospace',
    fontSize: 13,
  },
  signOutButton: {
    marginTop: spacing.xl,
  },
  footer: {
    color: colors.textFaint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
