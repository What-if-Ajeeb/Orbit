import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { usePluginPlatform, usePluginPlatformError, usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { PLUGIN_PERMISSION_META } from '@/lib/plugins/permissions';
import type {
  PluginSummary,
  PluginTrustLevel,
} from '@/lib/plugins/types';
import { radius, spacing } from '@/theme';

import { SmartPluginActivity } from '@/components/plugins/SmartPluginActivity';
import { usePluginActions } from '@/components/plugins/usePluginActions';

type Filter = 'all' | 'installed' | 'available' | 'updates';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'installed', label: 'Installed' },
  { id: 'available', label: 'Available' },
  { id: 'updates', label: 'Updates' },
];

const TRUST_LABEL: Record<PluginTrustLevel, string> = {
  official: 'Official',
  verified: 'Verified',
  community: 'Community',
  local: 'Local',
  untrusted: 'Untrusted',
};

const INSTALLED_STATUSES = new Set([
  'installed',
  'disabled',
  'enabling',
  'enabled',
  'starting',
  'running',
  'stopping',
  'error',
  'updating',
]);

function iconOrFallback(name: string | undefined): keyof typeof Ionicons.glyphMap {
  return name && name in Ionicons.glyphMap
    ? (name as keyof typeof Ionicons.glyphMap)
    : 'extension-puzzle-outline';
}

function statusLabel(summary: PluginSummary): string {
  if (summary.legacy) {
    return 'Legacy · quarantined';
  }

  switch (summary.status) {
    case 'running':
      return 'Running';
    case 'disabled':
      return 'Disabled';
    case 'error':
      return 'Error';
    case 'available':
      return 'Available';
    case 'installed':
      return 'Installed';
    default:
      return summary.status;
  }
}

function statusColor(
  summary: PluginSummary,
  colors: AppTheme['colors']
): string {
  if (summary.legacy || summary.status === 'error') {
    return colors.danger;
  }

  if (summary.status === 'running') {
    return colors.success;
  }

  if (summary.status === 'available') {
    return colors.accent;
  }

  return colors.textMuted;
}

export default function PluginsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { open: openSidebar } = useSidebar();
  const snapshot = usePluginSnapshot();
  const bootError = usePluginPlatformError();
  const actions = usePluginActions();
  const platform = usePluginPlatform();
  const [filter, setFilter] = useState<Filter>('all');

  const summaries = useMemo(() => {
    return snapshot.summaries.filter((summary) => {
      if (filter === 'updates') {
        return summary.hasUpdate;
      }

      if (filter === 'installed') {
        return INSTALLED_STATUSES.has(summary.status);
      }

      if (filter === 'available') {
        return summary.status === 'available';
      }

      return true;
    });
  }, [filter, snapshot.summaries]);

  const updates = snapshot.summaries.filter((summary) => summary.hasUpdate).length;

  function openDetail(pluginId: string) {
    router.navigate(`/plugins/${encodeURIComponent(pluginId)}` as Href);
  }

  function primaryAction(summary: PluginSummary) {
    const pluginId = summary.manifest.pluginId;
    const busy = actions.busyPluginId === pluginId;

    if (busy) {
      return <ActivityIndicator size="small" color={colors.accent} />;
    }

    if (summary.legacy) {
      return (
        <Pressable
          accessibilityRole="button"
          onPress={() => openDetail(pluginId)}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>Review</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.accent} />
        </Pressable>
      );
    }

    if (summary.hasUpdate) {
      return (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void actions.update(pluginId);
          }}
          style={({ pressed }) => [
            styles.action,
            styles.actionAccent,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="cloud-download-outline" size={14} color={colors.onInverse} />
          <Text style={styles.actionTextOnAccent}>Update</Text>
        </Pressable>
      );
    }

    if (summary.status === 'available') {
      return (
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            void actions.install(pluginId);
          }}
          style={({ pressed }) => [
            styles.action,
            styles.actionAccent,
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="add" size={15} color={colors.onInverse} />
          <Text style={styles.actionTextOnAccent}>Install</Text>
        </Pressable>
      );
    }

    if (summary.status === 'running') {
      return (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.navigate(
              `/plugin/${encodeURIComponent(pluginId)}` as Href
            )
          }
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Text style={styles.actionText}>Open</Text>
          <Ionicons name="arrow-forward" size={14} color={colors.accent} />
        </Pressable>
      );
    }

    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void actions.enable(pluginId);
        }}
        style={({ pressed }) => [
          styles.action,
          styles.actionAccent,
          pressed && styles.pressed,
        ]}
      >
        <Ionicons name="play" size={13} color={colors.onInverse} />
        <Text style={styles.actionTextOnAccent}>
          {summary.status === 'error' ? 'Retry' : 'Enable'}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.root}>
      <GlassBackdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <SidebarButton onPress={openSidebar} />
          <ScreenHeader
            title="Plugins"
            subtitle="Install, approve and control every extension in one place."
          />
        </View>

        <GlassView style={styles.stats}>
          <Stat label="Installed" value={snapshot.stats.installed} />
          <Stat label="Running" value={snapshot.stats.running} />
          <Stat label="Available" value={snapshot.stats.available} />
          <Stat label="Updates" value={updates} />
        </GlassView>

        {!snapshot.ready && !bootError ? (
          <View style={styles.banner}>
            <ActivityIndicator size="small" color={colors.accent} />
            <Text style={styles.bannerText}>Starting the plugin platform…</Text>
          </View>
        ) : null}

        {bootError || snapshot.error ? (
          <View style={[styles.banner, styles.bannerError]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.bannerErrorText}>
              {bootError ?? snapshot.error}
            </Text>
          </View>
        ) : null}

        {actions.error ? (
          <View style={[styles.banner, styles.bannerError]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.bannerErrorText}>{actions.error}</Text>
          </View>
        ) : null}

        {actions.notice ? (
          <View style={[styles.banner, styles.bannerNotice]}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
            <Text style={styles.bannerNoticeText}>{actions.notice}</Text>
          </View>
        ) : null}

        <SmartPluginActivity />

        <View style={styles.filters}>
          {FILTERS.map((item) => {
            const selected = filter === item.id;

            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(item.id)}
                style={({ pressed }) => [
                  styles.filter,
                  selected && styles.filterSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text
                  style={[styles.filterText, selected && styles.filterTextSelected]}
                >
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {summaries.length === 0 ? (
          <GlassView style={styles.empty}>
            <Ionicons name="extension-puzzle-outline" size={28} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No plugins here yet</Text>
            <Text style={styles.emptyBody}>
              {filter === 'available'
                ? 'Every bundled plugin is already installed.'
                : 'Switch filters or install the bundled example plugin from Available.'}
            </Text>
          </GlassView>
        ) : null}

        {summaries.map((summary) => {
          const pluginId = summary.manifest.pluginId;
          const core = snapshot.corePluginIds.includes(pluginId);

          return (
            <GlassView key={pluginId} style={styles.card}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${summary.manifest.name}`}
                onPress={() => openDetail(pluginId)}
                style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
              >
                <View style={styles.iconBubble}>
                  <Ionicons
                    name={iconOrFallback(summary.manifest.icon)}
                    size={22}
                    color={colors.accent}
                  />
                </View>

                <View style={styles.cardText}>
                  <View style={styles.nameRow}>
                    <Text numberOfLines={1} style={styles.name}>
                      {summary.manifest.name}
                    </Text>
                    <View style={styles.versionPill}>
                      <Text style={styles.versionText}>
                        v{summary.manifest.version}
                      </Text>
                    </View>
                    {core ? (
                      <View style={styles.corePill}>
                        <Text style={styles.coreText}>CORE</Text>
                      </View>
                    ) : null}
                  </View>

                  <Text numberOfLines={2} style={styles.description}>
                    {summary.manifest.description}
                  </Text>

                  <View style={styles.metaRow}>
                    <Text
                      style={[
                        styles.status,
                        { color: statusColor(summary, colors) },
                      ]}
                    >
                      ● {statusLabel(summary)}
                    </Text>
                    <Text style={styles.trust}>
                      {TRUST_LABEL[summary.trustLevel]} · {summary.source}
                    </Text>
                  </View>

                  {summary.missingPermissions.length > 0 &&
                  INSTALLED_STATUSES.has(summary.status) ? (
                    <View style={styles.permissionHint}>
                      <Ionicons name="lock-closed-outline" size={12} color={colors.warning} />
                      <Text style={styles.permissionHintText}>
                        Needs {summary.missingPermissions
                          .map((permission) => PLUGIN_PERMISSION_META[permission].label)
                          .join(', ')}
                      </Text>
                    </View>
                  ) : null}

                  {summary.error ? (
                    <Text numberOfLines={2} style={styles.errorText}>
                      {summary.error}
                    </Text>
                  ) : null}
                </View>
              </Pressable>

              <View style={styles.actionColumn}>{primaryAction(summary)}</View>
            </GlassView>
          );
        })}

        <View style={styles.footerLinks}>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              void actions.syncMcp();
            }}
            style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
          >
            <Ionicons name="refresh-outline" size={15} color={colors.accent} />
            <Text style={styles.linkText}>Sync MCP integrations</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate('/settings' as Href)}
            style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
          >
            <Ionicons name="settings-outline" size={15} color={colors.accent} />
            <Text style={styles.linkText}>MCP server settings</Text>
          </Pressable>
        </View>

        {platform.isCorePlugin('orbit.core.session') ? (
          <Text style={styles.footnote}>
            Core ORBIT services are mounted by the Cordis harness and appear here for
            visibility. Third-party plugins are declarative and never execute downloaded
            JavaScript.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: spacing.md,
      gap: spacing.md,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    stats: {
      flexDirection: 'row',
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    stat: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    statValue: {
      color: colors.text,
      fontSize: 22,
      fontWeight: '700',
    },
    statLabel: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '600',
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.fillSoft,
      padding: spacing.sm,
    },
    bannerText: {
      color: colors.textMuted,
      fontSize: 12,
    },
    bannerError: {
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
    },
    bannerErrorText: {
      flex: 1,
      color: colors.danger,
      fontSize: 12,
      lineHeight: 17,
    },
    bannerNotice: {
      borderColor: colors.success,
      backgroundColor: colors.successSoft,
    },
    bannerNoticeText: {
      flex: 1,
      color: colors.success,
      fontSize: 12,
      lineHeight: 17,
    },
    filters: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    filter: {
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.fillSoft,
      paddingHorizontal: spacing.md,
      paddingVertical: 7,
    },
    filterSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    filterText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    filterTextSelected: {
      color: colors.accent,
    },
    empty: {
      alignItems: 'center',
      gap: spacing.xs,
      borderRadius: radius.lg,
      padding: spacing.xl,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    emptyBody: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
      textAlign: 'center',
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.lg,
      padding: spacing.sm + 2,
    },
    cardMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    iconBubble: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardText: {
      flex: 1,
      gap: 3,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    name: {
      flexShrink: 1,
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    versionPill: {
      borderRadius: radius.pill,
      backgroundColor: glass.fillSoft,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    versionText: {
      color: colors.textMuted,
      fontSize: 9,
      fontWeight: '600',
    },
    corePill: {
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    coreText: {
      color: colors.accent,
      fontSize: 8,
      fontWeight: '800',
      letterSpacing: 0.8,
    },
    description: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    status: {
      fontSize: 10,
      fontWeight: '700',
    },
    trust: {
      color: colors.textFaint,
      fontSize: 10,
    },
    permissionHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    permissionHintText: {
      flex: 1,
      color: colors.warning,
      fontSize: 10,
      lineHeight: 14,
    },
    errorText: {
      color: colors.danger,
      fontSize: 10,
      lineHeight: 14,
    },
    actionColumn: {
      minWidth: 76,
      alignItems: 'flex-end',
    },
    action: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.fillSoft,
      paddingHorizontal: spacing.sm,
      paddingVertical: 7,
    },
    actionAccent: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    actionText: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '700',
    },
    actionTextOnAccent: {
      color: colors.onInverse,
      fontSize: 11,
      fontWeight: '700',
    },
    footerLinks: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.md,
      paddingVertical: spacing.sm,
    },
    linkButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    linkText: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: '600',
    },
    footnote: {
      color: colors.textFaint,
      fontSize: 10,
      lineHeight: 15,
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.78,
    },
  });
