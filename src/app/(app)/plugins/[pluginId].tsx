import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
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

import { EmptyState } from '@/components/EmptyState';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { PluginSettingsForm } from '@/components/plugins/PluginSettingsForm';
import { usePluginActions } from '@/components/plugins/usePluginActions';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SettingsSection } from '@/components/SettingsSection';
import { SidebarButton } from '@/components/SidebarButton';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
import { usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { formatRelative } from '@/lib/dates';
import {
  PLUGIN_PERMISSION_META,
  isSensitivePermission,
} from '@/lib/plugins/permissions';
import type {
  InstallHistoryRecord,
  PermissionAuditRecord,
  PluginPermission,
  PluginSummary,
  PluginTrustLevel,
} from '@/lib/plugins/types';
import { radius, spacing, typography } from '@/theme';

const TRUST_COPY: Record<PluginTrustLevel, string> = {
  official: 'Reviewed and shipped with ORBIT.',
  verified: 'Published by a verified publisher.',
  community: 'Community manifest. Review permissions before enabling.',
  local: 'Installed from this device. Treat with caution.',
  untrusted: 'Untrusted or legacy plugin. Executable code is never loaded.',
};

const AUDIT_LABEL: Record<PermissionAuditRecord['event'], string> = {
  permissions_requested: 'Permissions requested',
  permissions_granted: 'Permissions granted',
  permissions_denied: 'Permissions denied',
  permission_revoked: 'Permission revoked',
  permissions_revoked_all: 'All permissions revoked',
  permissions_changed_on_update: 'Permissions changed on update',
  permission_denied_at_runtime: 'Permission denied at runtime',
  mcp_consent_created: 'MCP consent created',
};

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
    case 'uninstalling':
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
    case 'enabled':
      return 'Installed';
    default:
      return summary.status;
  }
}

function auditTone(event: PermissionAuditRecord['event']): StatusTone {
  if (event === 'permissions_granted') {
    return 'success';
  }

  if (
    event === 'permissions_denied' ||
    event === 'permission_revoked' ||
    event === 'permissions_revoked_all' ||
    event === 'permission_denied_at_runtime'
  ) {
    return 'danger';
  }

  if (event === 'permissions_changed_on_update') {
    return 'warning';
  }

  return 'info';
}

function historyTone(status: InstallHistoryRecord['status']): StatusTone {
  if (status === 'failed') {
    return 'danger';
  }

  return status === 'started' ? 'warning' : 'success';
}

export default function PluginDetailScreen() {
  const params = useLocalSearchParams<{ pluginId?: string }>();
  const pluginId = params.pluginId ? decodeURIComponent(params.pluginId) : '';
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { open: openSidebar } = useSidebar();
  const snapshot = usePluginSnapshot();
  const actions = usePluginActions();
  const [history, setHistory] = useState<InstallHistoryRecord[]>([]);
  const [audit, setAudit] = useState<PermissionAuditRecord[]>([]);
  const [loadedActivityKey, setLoadedActivityKey] = useState('');

  const summary = useMemo(
    () =>
      snapshot.summaries.find(
        (candidate) => candidate.manifest.pluginId === pluginId
      ) ?? null,
    [pluginId, snapshot.summaries]
  );

  const core = snapshot.corePluginIds.includes(pluginId);
  const busy = actions.busyPluginId === pluginId;
  const activityKey = `${pluginId}:${snapshot.version}`;
  const loadingActivity = loadedActivityKey !== activityKey;
  const updateEntry =
    actions.platform.registry
      .getCatalogEntries()
      .find(
        (entry) =>
          entry.manifest.pluginId === pluginId && entry.hasUpdate
      ) ?? null;

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const [nextHistory, nextAudit] = await Promise.all([
          actions.platform.registry.installHistory(pluginId, 20),
          actions.platform.registry.permissionAudit(pluginId, 30),
        ]);

        if (active) {
          setHistory(nextHistory);
          setAudit(nextAudit);
        }
      } catch (loadError) {
        console.warn('Could not load plugin activity.', loadError);
      } finally {
        if (active) {
          setLoadedActivityKey(activityKey);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [actions.platform, pluginId, activityKey]);

  if (!summary) {
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
        >
          <View style={styles.headerRow}>
            <SidebarButton onPress={openSidebar} />
            <ScreenHeader
              title="Plugin not found"
              subtitle={pluginId || 'Missing plugin id'}
            />
          </View>
          <GlassView style={styles.section}>
            <EmptyState
              icon="help-circle-outline"
              title="Nothing to show here"
              message="This plugin is not in the bundled catalog on this device."
              actionLabel="Back to plugins"
              onAction={() => router.replace('/plugins' as Href)}
            />
          </GlassView>
        </ScrollView>
      </View>
    );
  }

  const manifest = summary.manifest;
  const installed = !['available', 'discovered'].includes(summary.status);
  const running = summary.status === 'running';
  const tone = statusTone(summary);

  function confirmUninstall() {
    Alert.alert(
      `Uninstall ${manifest.name}?`,
      'The plugin stops immediately and its contributions disappear. Choose whether to keep its settings and storage.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Keep data',
          onPress: () => {
            void actions.uninstall(pluginId, false);
          },
        },
        {
          text: 'Delete data',
          style: 'destructive',
          onPress: () => {
            void actions.uninstall(pluginId, true);
          },
        },
      ]
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
          <ScreenHeader title={manifest.name} subtitle={manifest.description} />
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.navigate('/plugins' as Href)}
          style={styles.backLink}
        >
          <Ionicons name="chevron-back" size={16} color={colors.accent} />
          <Text style={styles.backLinkText}>All plugins</Text>
        </Pressable>

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

        <GlassView style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <Ionicons
                name={
                  manifest.icon && manifest.icon in Ionicons.glyphMap
                    ? (manifest.icon as keyof typeof Ionicons.glyphMap)
                    : 'extension-puzzle-outline'
                }
                size={26}
                color={colors.accent}
              />
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroVersion}>
                v{manifest.version} · {manifest.pluginId}
              </Text>
              <Text style={styles.heroTrust}>
                {summary.trustLevel} · {summary.source}
                {core ? ' · Core service' : ''}
              </Text>
            </View>
            <StatusPill
              label={statusLabel(summary)}
              tone={tone}
              showDot={tone === 'success' || tone === 'danger'}
              style={styles.heroStatus}
            />
          </View>

          <Text style={styles.trustCopy}>{TRUST_COPY[summary.trustLevel]}</Text>

          {summary.error ? (
            <View style={styles.messageRow}>
              <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
              <Text style={styles.errorText}>{summary.error}</Text>
            </View>
          ) : null}

          {summary.health.lastError ? (
            <View style={styles.messageRow}>
              <Ionicons name="medical-outline" size={15} color={colors.warning} />
              <Text style={styles.healthText}>
                Health: {summary.health.status} · {summary.health.lastError}
              </Text>
            </View>
          ) : null}

          <View style={styles.actionsRow}>
            {!installed ? (
              <ActionButton
                label="Install"
                icon="add"
                busy={busy}
                onPress={() => {
                  void actions.install(pluginId);
                }}
              />
            ) : null}

            {installed && !running && !core ? (
              <ActionButton
                label="Enable"
                icon="play"
                busy={busy}
                onPress={() => {
                  void actions.enable(pluginId);
                }}
              />
            ) : null}

            {installed && running && !core ? (
              <ActionButton
                label="Disable"
                icon="pause"
                variant="secondary"
                busy={busy}
                onPress={() => {
                  void actions.disable(pluginId);
                }}
              />
            ) : null}

            {running ? (
              <ActionButton
                label="Open app"
                icon="arrow-forward"
                variant="secondary"
                busy={false}
                disabled={manifest.routes.length === 0}
                onPress={() =>
                  router.navigate(
                    `/plugin/${encodeURIComponent(pluginId)}` as Href
                  )
                }
              />
            ) : null}

            {updateEntry ? (
              <ActionButton
                label={`Update to ${updateEntry.manifest.version}`}
                icon="cloud-download-outline"
                busy={busy}
                onPress={() => {
                  void actions.update(pluginId);
                }}
              />
            ) : null}

            {installed && !core && !summary.legacy ? (
              <ActionButton
                label="Uninstall"
                icon="trash-outline"
                variant="danger"
                busy={busy}
                onPress={confirmUninstall}
              />
            ) : null}
          </View>

          {core ? (
            <Text style={styles.note}>
              This is a core ORBIT service. It is mounted by the Cordis harness and
              cannot be disabled or uninstalled from the Plugin Manager.
            </Text>
          ) : null}

          {summary.legacy ? (
            <Text style={styles.note}>
              This record was imported from the legacy plugin store as untrusted and
              disabled. Its executable source was not migrated and will never run.
            </Text>
          ) : null}
        </GlassView>

        <GlassView style={styles.section}>
          <SettingsSection
            title="Permissions"
            description="Default deny. A plugin receives nothing until you approve each permission."
          >
            {manifest.permissions.length === 0 ? (
              <Text style={styles.muted}>This plugin requests no permissions.</Text>
            ) : (
              <View style={styles.rows}>
                {manifest.permissions.map((permission: PluginPermission) => {
                  const meta = PLUGIN_PERMISSION_META[permission];
                  const granted =
                    summary.grantedPermissions.includes(permission) &&
                    actions.platform.permissions.has(pluginId, permission);
                  const sensitive = isSensitivePermission(permission);

                  return (
                    <View key={permission} style={styles.permissionRow}>
                      <Ionicons
                        name={sensitive ? 'warning-outline' : 'shield-checkmark-outline'}
                        size={18}
                        color={sensitive ? colors.warning : colors.accent}
                      />
                      <View style={styles.permissionText}>
                        <View style={styles.permissionTitleRow}>
                          <Text style={styles.permissionLabel}>{meta.label}</Text>
                          <StatusPill
                            label={granted ? 'Granted' : 'Not granted'}
                            tone={granted ? 'success' : 'neutral'}
                          />
                        </View>
                        <Text style={styles.permissionDetail}>{meta.description}</Text>
                        <Text style={styles.permissionMeta}>
                          {meta.risk} risk{sensitive ? ' · Sensitive' : ''}
                        </Text>
                      </View>

                      {!core ? (
                        <Pressable
                          accessibilityRole="button"
                          disabled={busy}
                          onPress={() => {
                            if (granted) {
                              void actions.revokePermission(pluginId, permission);
                            } else {
                              void actions.grantPermission(pluginId, permission);
                            }
                          }}
                          style={({ pressed }) => [
                            styles.permissionAction,
                            granted && styles.permissionActionDanger,
                            pressed && styles.pressed,
                            busy && styles.disabled,
                          ]}
                        >
                          <Text
                            style={[
                              styles.permissionActionText,
                              granted && styles.permissionActionTextDanger,
                            ]}
                          >
                            {granted ? 'Revoke' : 'Grant'}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </View>
            )}
          </SettingsSection>
        </GlassView>

        <GlassView style={styles.section}>
          <SettingsSection
            title="Settings"
            description="Values are saved on this device."
          >
            <PluginSettingsForm
              platform={actions.platform}
              pluginId={pluginId}
              fields={manifest.settingsSchema}
            />
          </SettingsSection>
        </GlassView>

        <GlassView style={styles.section}>
          <SettingsSection
            title="Contributions"
            description="What this plugin adds to ORBIT."
          >
            <View style={styles.chips}>
              <StatusPill label={`${manifest.routes.length} routes`} />
              <StatusPill label={`${manifest.navigationEntries.length} sidebar`} />
              <StatusPill label={`${manifest.dashboardWidgets.length} widgets`} />
              <StatusPill label={`${manifest.settingsSections.length} settings`} />
              <StatusPill label={`${manifest.mcpTools.length} MCP tools`} />
              <StatusPill label={`${manifest.dependencies.length} deps`} />
            </View>

            <View style={styles.detailGrid}>
              <DetailRow label="Category" value={manifest.category} />
              <DetailRow label="Entry point" value={manifest.entryPoint.kind} />
              <DetailRow
                label="Platforms"
                value={manifest.platformSupport.join(', ')}
              />
              <DetailRow
                label="Min Orbit"
                value={manifest.minimumOrbitVersion}
              />
              <DetailRow label="Publisher" value={manifest.publisher.name} />
              <DetailRow label="Update policy" value={manifest.updatePolicy} />
              <DetailRow
                label="Installed"
                value={
                  summary.installedAt
                    ? formatRelative(summary.installedAt)
                    : 'Not installed'
                }
              />
              <DetailRow
                label="Updated"
                value={summary.updatedAt ? formatRelative(summary.updatedAt) : '—'}
              />
            </View>
          </SettingsSection>
        </GlassView>

        <GlassView style={styles.section}>
          <SettingsSection
            title="Permission audit"
            description="Approval decisions recorded for this plugin."
          >
            {loadingActivity && audit.length === 0 ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : audit.length === 0 ? (
              <Text style={styles.muted}>No permission decisions recorded yet.</Text>
            ) : (
              <View style={styles.rows}>
                {audit.map((record) => (
                  <View key={record.id} style={styles.activityRow}>
                    <StatusPill
                      label={AUDIT_LABEL[record.event]}
                      tone={auditTone(record.event)}
                      style={styles.auditPill}
                    />
                    <Text style={styles.activityDetail}>{record.detail}</Text>
                    <Text style={styles.activityMeta}>
                      {record.permissions
                        .map(
                          (permission) => PLUGIN_PERMISSION_META[permission].label
                        )
                        .join(', ') || 'No permissions'} · {record.source} ·{' '}
                      {formatRelative(record.createdAt)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </SettingsSection>
        </GlassView>

        <GlassView style={styles.section}>
          <SettingsSection
            title="Install history"
            description="Lifecycle changes recorded for this plugin."
          >
            {loadingActivity && history.length === 0 ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : history.length === 0 ? (
              <Text style={styles.muted}>No install activity recorded yet.</Text>
            ) : (
              <View style={styles.rows}>
                {history.map((record) => (
                  <View key={record.id} style={styles.historyRow}>
                    <StatusPill
                      label={`${record.action} · ${record.status}`}
                      tone={historyTone(record.status)}
                      style={styles.historyPill}
                    />
                    <Text style={styles.historyDetail}>{record.detail}</Text>
                    <Text style={styles.activityMeta}>
                      {record.fromVersion ? `${record.fromVersion} → ` : ''}
                      {record.toVersion ?? '—'} · {formatRelative(record.createdAt)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </SettingsSection>
        </GlassView>
      </ScrollView>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  busy,
  disabled,
  variant = 'primary',
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  busy: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const bg =
    variant === 'primary'
      ? colors.inverse
      : variant === 'danger'
        ? colors.dangerSoft
        : colors.surfaceAlt;
  const fg =
    variant === 'primary'
      ? colors.onInverse
      : variant === 'danger'
        ? colors.danger
        : colors.text;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionButton,
        { backgroundColor: bg },
        pressed && styles.pressed,
        (busy || disabled) && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <Ionicons name={icon} size={15} color={fg} />
      )}
      <Text style={[styles.actionButtonText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
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
    backLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      alignSelf: 'flex-start',
    },
    backLinkText: {
      color: colors.accent,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      padding: spacing.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
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
    hero: {
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    heroTop: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    heroIcon: {
      width: 46,
      height: 46,
      borderRadius: 14,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    heroText: {
      flex: 1,
      gap: 2,
    },
    heroVersion: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    heroTrust: {
      color: colors.textMuted,
      ...typography.caption,
    },
    heroStatus: {
      maxWidth: 120,
    },
    trustCopy: {
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    messageRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
    },
    errorText: {
      flex: 1,
      color: colors.danger,
      ...typography.bodySmall,
    },
    healthText: {
      flex: 1,
      color: colors.warning,
      ...typography.caption,
    },
    actionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      paddingTop: spacing.xs,
    },
    actionButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: 9,
    },
    actionButtonText: {
      ...typography.bodySmall,
      fontWeight: '600',
    },
    note: {
      color: colors.textFaint,
      ...typography.caption,
    },
    section: {
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    muted: {
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    rows: {
      gap: spacing.sm,
    },
    permissionRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      padding: spacing.sm,
    },
    permissionText: {
      flex: 1,
      gap: 3,
    },
    permissionTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.xs,
    },
    permissionLabel: {
      flexShrink: 1,
      color: colors.text,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    permissionDetail: {
      color: colors.textMuted,
      ...typography.caption,
    },
    permissionMeta: {
      color: colors.textFaint,
      ...typography.caption,
    },
    permissionAction: {
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accent,
      paddingHorizontal: spacing.sm,
      paddingVertical: 6,
    },
    permissionActionDanger: {
      borderColor: colors.danger,
    },
    permissionActionText: {
      color: colors.accent,
      ...typography.caption,
      fontWeight: '700',
    },
    permissionActionTextDanger: {
      color: colors.danger,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    detailGrid: {
      gap: spacing.xs,
    },
    detailRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    detailLabel: {
      width: 90,
      color: colors.textFaint,
      ...typography.caption,
      fontWeight: '600',
    },
    detailValue: {
      flex: 1,
      color: colors.textMuted,
      ...typography.caption,
    },
    activityRow: {
      gap: 3,
      paddingBottom: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    auditPill: {
      maxWidth: '100%',
    },
    activityDetail: {
      color: colors.textMuted,
      ...typography.caption,
    },
    activityMeta: {
      color: colors.textFaint,
      ...typography.caption,
      fontSize: 11,
    },
    historyRow: {
      gap: 3,
      paddingBottom: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    historyPill: {
      maxWidth: '100%',
    },
    historyDetail: {
      color: colors.textMuted,
      ...typography.caption,
    },
    pressed: {
      opacity: 0.78,
    },
    disabled: {
      opacity: 0.5,
    },
  });
