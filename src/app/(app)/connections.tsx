import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormError } from '@/components/FormError';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { McpServersCard } from '@/components/McpServersCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { listConnectionActions } from '@/lib/connections/api';
import {
  connectGoogle,
  disconnectGoogle,
  listGoogleConnectionStates,
  sanitizeConnectionMessage,
} from '@/lib/connections/google';
import type { ConnectionState, ConnectionStatus, GoogleConnectionId } from '@/lib/connections/types';
import { radius, spacing } from '@/theme';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  not_configured: 'Setup needed',
  disconnected: 'Not connected',
  connecting: 'Connecting…',
  connected: 'Connected',
  expired: 'Expired',
  error: 'Error',
};

const STATUS_ICONS: Record<ConnectionStatus, keyof typeof Ionicons.glyphMap> = {
  not_configured: 'construct-outline',
  disconnected: 'link-outline',
  connecting: 'time-outline',
  connected: 'checkmark-circle-outline',
  expired: 'refresh-outline',
  error: 'alert-circle-outline',
};

function statusColor(status: ConnectionStatus, colors: { success: string; warning: string; danger: string; textFaint: string; accent: string }): string {
  switch (status) {
    case 'connected':
      return colors.success;
    case 'expired':
    case 'not_configured':
      return colors.warning;
    case 'error':
      return colors.danger;
    case 'connecting':
      return colors.accent;
    default:
      return colors.textFaint;
  }
}

export default function ConnectionsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const [states, setStates] = useState<ConnectionState[]>([]);
  const [busy, setBusy] = useState<GoogleConnectionId | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      const next = await listGoogleConnectionStates(user.id, true);
      setStates(next);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Could not check connected accounts.'
      );
    } finally {
      setLoading(false);
    }
  }, [user]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  if (!user) {
    return null;
  }

  const activeUser = user;

  async function connect(id: GoogleConnectionId) {
    setBusy(id);
    setError(null);
    setNotice(null);

    try {
      const state = await connectGoogle(activeUser.id, id);
      setStates((current) => current.map((item) => (item.id === id ? state : item)));
      setNotice(`${state.label} is connected. Tools from this account are now available.`);
    } catch (connectError) {
      const message =
        connectError instanceof Error
          ? sanitizeConnectionMessage(connectError.message)
          : 'Could not connect this account.';

      if (!message.toLowerCase().includes('cancel')) {
        setError(message);
      }

      await load();
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(state: ConnectionState) {
    setBusy(state.id);
    setError(null);
    setNotice(null);

    try {
      const result = await disconnectGoogle(activeUser.id, state.id);
      setStates((current) =>
        current.map((item) =>
          item.id === state.id
            ? {
                ...item,
                status: 'disconnected',
                email: null,
                expiresAt: null,
                detail: result.detail,
              }
            : item
        )
      );
      setNotice(
        result.revoked
          ? `${state.label} was disconnected and access was revoked.`
          : `${state.label} was removed from this device.`
      );
    } catch (disconnectError) {
      setError(
        disconnectError instanceof Error
          ? sanitizeConnectionMessage(disconnectError.message)
          : 'Could not disconnect this account.'
      );
    } finally {
      setBusy(null);
    }
  }

  const needsSetup = states.some((state) => state.status === 'not_configured');

  return (
    <View style={styles.root}>
      <GlassBackdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="Tool connections"
          title="Connected accounts"
          subtitle="Google accounts use real OAuth and device-secure token storage. Nothing shows as connected until Google confirms it."
          left={<SidebarButton onPress={openSidebar} />}
        />

        <FormError message={error} onDismiss={() => setError(null)} />
        {notice ? (
          <View style={styles.success}>
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
            <Text style={styles.successText}>{notice}</Text>
          </View>
        ) : null}

        {needsSetup ? (
          <GlassView style={styles.setup}>
            <Ionicons name="information-circle-outline" size={20} color={colors.warning} />
            <View style={styles.setupCopy}>
              <Text style={styles.setupTitle}>Google sign-in needs app configuration</Text>
              <Text style={styles.setupText}>
                Set EXPO_PUBLIC_GOOGLE_OAUTH_CLIENT_ID in EAS environment secrets, then rebuild.
                Until then Google tools stay unavailable.
              </Text>
            </View>
          </GlassView>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
            <Text style={styles.loadingText}>Checking account status…</Text>
          </View>
        ) : (
          <View style={styles.list}>
            {states.map((state) => {
              const isBusy = busy === state.id;
              const canConnect = state.configured && state.status !== 'connected';

              return (
                <GlassView key={state.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={styles.iconWrap}>
                      <Ionicons
                        name={state.id === 'gmail' ? 'mail-outline' : state.id === 'google_drive' ? 'folder-open-outline' : 'calendar-outline'}
                        size={22}
                        color={colors.accent}
                      />
                    </View>
                    <View style={styles.cardCopy}>
                      <Text style={styles.cardTitle}>{state.label}</Text>
                      <Text style={styles.cardDescription}>{state.description}</Text>
                    </View>
                    <View
                      style={[
                        styles.statusPill,
                        { backgroundColor: `${statusColor(state.status, colors)}22` },
                      ]}
                    >
                      <Ionicons
                        name={STATUS_ICONS[state.status]}
                        size={13}
                        color={statusColor(state.status, colors)}
                      />
                      <Text style={[styles.statusText, { color: statusColor(state.status, colors) }]}>
                        {STATUS_LABEL[state.status]}
                      </Text>
                    </View>
                  </View>

                  {state.email ? <Text style={styles.email}>{state.email}</Text> : null}
                  {state.detail ? (
                    <Text style={styles.detail}>{sanitizeConnectionMessage(state.detail)}</Text>
                  ) : null}

                  <View style={styles.actionsRow}>
                    <View style={styles.actionButtons}>
                      <Button
                        label={state.status === 'expired' ? 'Reconnect' : 'Connect'}
                        onPress={() => void connect(state.id)}
                        disabled={!canConnect || isBusy}
                        loading={isBusy && canConnect}
                      />
                      {state.status === 'connected' || state.status === 'expired' ? (
                        <Button
                          label="Disconnect"
                          variant="secondary"
                          onPress={() => void disconnect(state)}
                          disabled={isBusy}
                        />
                      ) : null}
                    </View>
                  </View>

                  <View style={styles.actionList}>
                    <Text style={styles.actionHeading}>Available to agents</Text>
                    {listConnectionActions(state.id as GoogleConnectionId).map((action) => (
                      <Text key={action} style={styles.actionItem}>
                        · {action}
                      </Text>
                    ))}
                  </View>
                </GlassView>
              );
            })}
          </View>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>MCP servers</Text>
          <Text style={styles.sectionNote}>
            Discovered through your saved configs. Tools are registered through the existing MCP
            runtime and gated by plugin permissions.
          </Text>
        </View>
        <McpServersCard onNotice={setNotice} onError={setError} />

        <View style={styles.links}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/marketplace' as Href)}
            style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
          >
            <Ionicons name="storefront-outline" size={20} color={colors.accent} />
            <View style={styles.linkCopy}>
              <Text style={styles.linkTitle}>Tool Marketplace</Text>
              <Text style={styles.linkText}>Browse built-in, plugin, MCP and account tools.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push('/tool-permissions' as Href)}
            style={({ pressed }) => [styles.linkCard, pressed && styles.pressed]}
          >
            <Ionicons name="key-outline" size={20} color={colors.accent} />
            <View style={styles.linkCopy}>
              <Text style={styles.linkTitle}>Tool permissions</Text>
              <Text style={styles.linkText}>Review grants and revoke access by agent.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
    },
    loading: {
      paddingVertical: spacing.xl,
      alignItems: 'center',
      gap: spacing.sm,
    },
    loadingText: {
      color: colors.textMuted,
      fontSize: 14,
    },
    success: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.successSoft,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    successText: {
      flex: 1,
      color: colors.success,
      fontSize: 13,
    },
    setup: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
      padding: spacing.md,
      borderColor: `${colors.warning}44`,
    },
    setupCopy: {
      flex: 1,
      gap: 4,
    },
    setupTitle: {
      color: colors.warning,
      fontSize: 14,
      fontWeight: '700',
    },
    setupText: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
    },
    list: {
      gap: spacing.md,
    },
    card: {
      padding: spacing.md,
      gap: spacing.md,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    iconWrap: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardCopy: {
      flex: 1,
      gap: 3,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    cardDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    statusText: {
      fontSize: 11,
      fontWeight: '700',
    },
    email: {
      color: colors.text,
      fontSize: 13,
    },
    detail: {
      color: colors.warning,
      fontSize: 12,
      lineHeight: 17,
    },
    actionsRow: {
      flexDirection: 'row',
    },
    actionButtons: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexShrink: 1,
    },
    actionList: {
      gap: 2,
    },
    actionHeading: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
      marginBottom: spacing.xs,
    },
    actionItem: {
      color: colors.textFaint,
      fontSize: 12,
      lineHeight: 17,
    },
    sectionHeader: {
      paddingTop: spacing.md,
      gap: 4,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 19,
      fontWeight: '700',
    },
    sectionNote: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
    },
    links: {
      gap: spacing.sm,
    },
    linkCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.md,
    },
    linkCopy: {
      flex: 1,
      gap: 3,
    },
    linkTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    linkText: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    pressed: {
      opacity: 0.8,
    },
  });
