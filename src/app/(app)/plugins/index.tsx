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

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SettingsSection } from '@/components/SettingsSection';
import { SidebarButton } from '@/components/SidebarButton';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
import { PinPluginButton } from '@/components/plugins/PinPluginButton';
import { usePluginPlatform, usePluginPlatformError, usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { PLUGIN_PERMISSION_META } from '@/lib/plugins/permissions';
import type {
  PluginSummary,
  PluginTrustLevel,
} from '@/lib/plugins/types';
import { layout, radius, spacing, typography } from '@/theme';

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

function statusTone(summary: PluginSummary): StatusTone {
  if (summary.legacy || summary.status === 'error') {
    return 'danger';
  }

  switch (summary.status) {
    case 'running':
      return 'success';
    case 'available':
      return 'accent';
    case 'installed':
    case 'enabled':
      return 'info';
    case 'enabling':
    case 'starting':
    case 'stopping':
    case 'updating':
    case 'installing':
      return 'warning';
    default:
      return 'neutral';
  }
}

function statusLabel(summary: PluginSummary): string {
  if (summary.legacy) {
    return 'Legacy';
  }

  switch (summary.status) {
    case 'enabling':
      return 'Enabling…';
    case 'starting':
      return 'Starting…';
    case 'stopping':
      return 'Stopping…';
    case 'updating':
      return 'Updating…';
    case 'installing':
      return 'Installing…';
    case 'uninstalling':
      return 'Uninstalling…';
    case 'enabled':
      return 'Enabled';
    case 'discovered':
      return 'Discovered';
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
      return (
        <View style={styles.busyAction} accessibilityRole="text" accessibilityLabel="Working">
          <ActivityIndicator size="small" color={colors.accent} />
        </View>
      );
    }

    if (summary.legacy) {
      return (
        <Button
          label="Review"
          variant="secondary"
          onPress={() => openDetail(pluginId)}
          style={styles.actionButton}
        />
      );
    }

    if (summary.hasUpdate) {
      return (
        <Button
          label="Update"
          onPress={() => {
            void actions.update(pluginId);
          }}
          style={styles.actionButton}
        />
      );
    }

    if (summary.status === 'available') {
      return (
        <Button
          label="Install"
          onPress={() => {
            void actions.install(pluginId);
          }}
          style={styles.actionButton}
        />
      );
    }

    if (summary.status === 'running') {
      return (
        <Button
          label="Open"
          variant="secondary"
          onPress={() =>
            router.navigate(
              `/plugin/${encodeURIComponent(pluginId)}` as Href
            )
          }
          style={styles.actionButton}
        />
      );
    }

    return (
      <Button
        label={summary.status === 'error' ? 'Retry' : 'Enable'}
        onPress={() => {
          void actions.enable(pluginId);
        }}
        style={styles.actionButton}
      />
    );
  }

  const emptyMessage =
    filter === 'available'
      ? 'Every bundled plugin is already installed. Choose another filter to review them.'
      : filter === 'updates'
        ? 'All installed plugins are up to date.'
        : 'Switch filters to review installed or available plugins.';

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

        <GlassView style={styles.builderCard}>
          <View style={styles.builderIconWrap}>
            <Ionicons name="hammer-outline" size={22} color={colors.accent} />
          </View>
          <View style={styles.builderText}>
            <Text style={styles.builderTitle}>Build your own plugin</Text>
            <Text style={styles.builderDescription}>
              Create a safe, declarative plugin with guided steps and test it in the sandbox.
            </Text>
          </View>
          <View style={styles.builderActions}>
            <Button
              label="My Plugins"
              variant="secondary"
              onPress={() => router.navigate('/plugins/my-plugins' as Href)}
              style={styles.builderButton}
            />
            <Button
              label="Create Plugin"
              onPress={() => router.push('/plugins/builder' as Href)}
              style={styles.builderButton}
            />
          </View>
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

        <SettingsSection
          title="Plugin library"
          description="Bundled extensions are reviewed before they are installed."
          action={
            <Text style={styles.count}>
              {snapshot.summaries.length} total
            </Text>
          }
        >
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
            <EmptyState
              icon="extension-puzzle-outline"
              title="No plugins to show"
              message={emptyMessage}
              actionLabel={filter === 'all' ? 'Browse marketplace' : 'Show all plugins'}
              onAction={() => {
                if (filter === 'all') {
                  router.push('/marketplace' as Href);
                } else {
                  setFilter('all');
                }
              }}
            />
          ) : (
            <View style={styles.list}>
              {summaries.map((summary) => {
                const pluginId = summary.manifest.pluginId;
                const core = snapshot.corePluginIds.includes(pluginId);
                const tone = statusTone(summary);

                return (
                  <GlassView key={pluginId} style={styles.card}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${summary.manifest.name}`}
                      onPress={() => openDetail(pluginId)}
                      style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
                    >
                      <View style={styles.iconWrap}>
                        <Ionicons
                          name={iconOrFallback(summary.manifest.icon)}
                          size={21}
                          color={colors.accent}
                        />
                      </View>

                      <View style={styles.cardText}>
                        <View style={styles.titleRow}>
                          <Text numberOfLines={1} style={styles.name}>
                            {summary.manifest.name}
                          </Text>
                          <StatusPill
                            label={statusLabel(summary)}
                            tone={tone}
                            showDot={tone === 'success' || tone === 'danger'}
                            style={styles.statusPill}
                          />
                        </View>

                        <Text numberOfLines={2} style={styles.description}>
                          {summary.manifest.description}
                        </Text>

                        <Text numberOfLines={1} style={styles.meta}>
                          v{summary.manifest.version} · {TRUST_LABEL[summary.trustLevel]} ·{' '}
                          {summary.source}
                          {core ? ' · Core' : ''}
                        </Text>

                        {summary.missingPermissions.length > 0 &&
                        INSTALLED_STATUSES.has(summary.status) ? (
                          <View style={styles.permissionHint}>
                            <Ionicons
                              name="lock-closed-outline"
                              size={13}
                              color={colors.warning}
                            />
                            <Text style={styles.permissionHintText}>
                              Needs {summary.missingPermissions
                                .map(
                                  (permission) =>
                                    PLUGIN_PERMISSION_META[permission].label
                                )
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

                    <View style={styles.actionColumn}>
                      {!summary.legacy && INSTALLED_STATUSES.has(summary.status) ? (
                        <PinPluginButton
                          pluginId={pluginId}
                          label={summary.manifest.name}
                        />
                      ) : null}
                      {primaryAction(summary)}
                    </View>
                  </GlassView>
                );
              })}
            </View>
          )}
        </SettingsSection>

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

const makeStyles = ({ colors }: AppTheme) =>
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
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    stat: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    statValue: {
      color: colors.text,
      ...typography.section,
      fontWeight: '700',
    },
    statLabel: {
      color: colors.textMuted,
      ...typography.caption,
      fontWeight: '600',
    },
    builderCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.lg,
      padding: spacing.sm + 2,
      flexWrap: 'wrap',
    },
    builderIconWrap: {
      width: 42,
      height: 42,
      borderRadius: 12,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    builderText: {
      flex: 1,
      minWidth: 160,
      gap: 2,
    },
    builderTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    builderDescription: {
      color: colors.textMuted,
      ...typography.caption,
    },
    builderActions: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    builderButton: {
      minHeight: layout.touchTarget - 4,
      paddingHorizontal: spacing.md,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      padding: spacing.sm,
    },
    bannerText: {
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    bannerError: {
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
    },
    bannerErrorText: {
      flex: 1,
      color: colors.danger,
      ...typography.bodySmall,
    },
    bannerNotice: {
      borderColor: colors.success,
      backgroundColor: colors.successSoft,
    },
    bannerNoticeText: {
      flex: 1,
      color: colors.success,
      ...typography.bodySmall,
    },
    count: {
      color: colors.textFaint,
      ...typography.caption,
    },
    filters: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    filter: {
      minHeight: 36,
      justifyContent: 'center',
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: spacing.md,
    },
    filterSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    filterText: {
      color: colors.textMuted,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    filterTextSelected: {
      color: colors.accent,
    },
    list: {
      gap: spacing.sm,
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
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardText: {
      flex: 1,
      gap: 3,
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    name: {
      flexShrink: 1,
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    statusPill: {
      maxWidth: 120,
    },
    description: {
      color: colors.textMuted,
      ...typography.caption,
    },
    meta: {
      color: colors.textFaint,
      ...typography.caption,
    },
    permissionHint: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    permissionHintText: {
      flex: 1,
      color: colors.warning,
      ...typography.caption,
    },
    errorText: {
      color: colors.danger,
      ...typography.caption,
    },
    actionColumn: {
      minWidth: 88,
      alignItems: 'flex-end',
      gap: spacing.xs,
    },
    actionButton: {
      minHeight: layout.touchTarget - 4,
      paddingHorizontal: spacing.md,
    },
    busyAction: {
      width: 88,
      minHeight: layout.touchTarget - 4,
      alignItems: 'center',
      justifyContent: 'center',
    },
    footerLinks: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.md,
      paddingVertical: spacing.xs,
    },
    linkButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    linkText: {
      color: colors.accent,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    footnote: {
      color: colors.textFaint,
      ...typography.caption,
      textAlign: 'center',
    },
    pressed: {
      opacity: 0.78,
    },
  });
