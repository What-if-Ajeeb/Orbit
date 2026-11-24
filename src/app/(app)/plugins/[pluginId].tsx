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

import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { PluginSettingsForm } from '@/components/plugins/PluginSettingsForm';
import { usePluginActions } from '@/components/plugins/usePluginActions';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
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
  PluginTrustLevel,
} from '@/lib/plugins/types';
import { radius, spacing } from '@/theme';

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
        <View style={[styles.content, { paddingTop: insets.top + spacing.md }]}>
          <ScreenHeader title="Plugin not found" subtitle={pluginId || 'Missing plugin id'} />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/plugins' as Href)}
            style={styles.backLink}
          >
            <Ionicons name="chevron-back" size={16} color={colors.accent} />
            <Text style={styles.backLinkText}>Back to plugins</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const manifest = summary.manifest;
  const installed = !['available', 'discovered'].includes(summary.status);
  const running = summary.status === 'running';

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
                size={28}
                color={colors.accent}
              />
            </View>
            <View style={styles.heroText}>
              <Text style={styles.heroVersion}>
                v{manifest.version} · {manifest.pluginId}
              </Text>
              <Text style={styles.heroTrust}>
                {summary.trustLevel} · {summary.source}
                {core ? ' · core service' : ''}
              </Text>
            </View>
            <View
              style={[
                styles.statusPill,
                {
                  backgroundColor: running
                    ? colors.successSoft
                    : summary.status === 'error'
                      ? colors.dangerSoft
                      : colors.accentSoft,
                },
              ]}
            >
              <Text
                style={[
                  styles.statusPillText,
                  {
                    color: running
                      ? colors.success
                      : summary.status === 'error'
                        ? colors.danger
                        : colors.accent,
                  },
                ]}
              >
                {summary.legacy ? 'legacy' : summary.status}
              </Text>
            </View>
          </View>

          <Text style={styles.trustCopy}>{TRUST_COPY[summary.trustLevel]}</Text>

          {summary.error ? (
            <Text style={styles.errorText}>{summary.error}</Text>
          ) : null}

          {summary.health.lastError ? (
            <Text style={styles.healthText}>
              Health: {summary.health.status} · {summary.health.lastError}
            </Text>
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
            <Text style={styles.coreNote}>
              This is a core ORBIT service. It is mounted by the Cordis harness and
              cannot be disabled or uninstalled from the Plugin Manager.
            </Text>
          ) : null}

          {summary.legacy ? (
            <Text style={styles.coreNote}>
              This record was imported from the legacy plugin store as untrusted and
              disabled. Its executable source was not migrated and will never run.
            </Text>
          ) : null}
        </GlassView>

        <GlassView style={styles.section}>
          <Text style={styles.sectionTitle}>Permissions</Text>
          <Text style={styles.sectionHint}>
            Default deny. A plugin receives nothing until you approve each permission.
          </Text>

          {manifest.permissions.length === 0 ? (
            <Text style={styles.muted}>This plugin requests no permissions.</Text>
          ) : (
            manifest.permissions.map((permission: PluginPermission) => {
              const meta = PLUGIN_PERMISSION_META[permission];
              const granted =
                summary.grantedPermissions.includes(permission) &&
                actions.platform.permissions.has(pluginId, permission);
              const sensitive = isSensitivePermission(permission);

              return (
                <View key={permission} style={styles.permissionRow}>
                  <Ionicons
                    name={sensitive ? 'warning-outline' : 'shield-checkmark-outline'}
                    size={17}
                    color={sensitive ? colors.warning : colors.accent}
                  />
                  <View style={styles.permissionText}>
                    <Text style={styles.permissionLabel}>{meta.label}</Text>
                    <Text style={styles.permissionDetail}>{meta.description}</Text>
                    <Text
                      style={[
                        styles.permissionState,
                        { color: granted ? colors.success : colors.textFaint },
                      ]}
                    >
                      {granted ? 'Granted' : 'Not granted'} · {meta.risk} risk
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
            })
          )}
        </GlassView>

        <GlassView style={styles.section}>
          <Text style={styles.sectionTitle}>Settings</Text>
          <PluginSettingsForm
            platform={actions.platform}
            pluginId={pluginId}
            fields={manifest.settingsSchema}
          />
        </GlassView>

        <GlassView style={styles.section}>
          <Text style={styles.sectionTitle}>Contributions</Text>
          <View style={styles.chips}>
            <Chip label={`${manifest.routes.length} routes`} />
            <Chip label={`${manifest.navigationEntries.length} sidebar`} />
            <Chip label={`${manifest.dashboardWidgets.length} widgets`} />
            <Chip label={`${manifest.settingsSections.length} settings`} />
            <Chip label={`${manifest.mcpTools.length} MCP tools`} />
            <Chip label={`${manifest.dependencies.length} deps`} />
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
        </GlassView>

        <GlassView style={styles.section}>
          <Text style={styles.sectionTitle}>Permission audit</Text>

          {loadingActivity && audit.length === 0 ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : audit.length === 0 ? (
            <Text style={styles.muted}>No permission decisions recorded yet.</Text>
          ) : (
            audit.map((record) => (
              <View key={record.id} style={styles.activityRow}>
                <View style={styles.activityDot} />
                <View style={styles.activityText}>
                  <Text style={styles.activityTitle}>
                    {AUDIT_LABEL[record.event]}
                  </Text>
                  <Text style={styles.activityDetail}>{record.detail}</Text>
                  <Text style={styles.activityMeta}>
                    {record.permissions
                      .map((permission) => PLUGIN_PERMISSION_META[permission].label)
                      .join(', ') || 'No permissions'} · {record.source} ·{' '}
                    {formatRelative(record.createdAt)}
                  </Text>
                </View>
              </View>
            ))
          )}
        </GlassView>

        <GlassView style={styles.section}>
          <Text style={styles.sectionTitle}>Install history</Text>

          {loadingActivity && history.length === 0 ? (
            <ActivityIndicator size="small" color={colors.accent} />
          ) : history.length === 0 ? (
            <Text style={styles.muted}>No install activity recorded yet.</Text>
          ) : (
            history.map((record) => (
              <View key={record.id} style={styles.historyRow}>
                <Text
                  style={[
                    styles.historyAction,
                    {
                      color:
                        record.status === 'failed'
                          ? colors.danger
                          : record.status === 'started'
                            ? colors.warning
                            : colors.success,
                    },
                  ]}
                >
                  {record.action} · {record.status}
                </Text>
                <Text style={styles.historyDetail}>{record.detail}</Text>
                <Text style={styles.activityMeta}>
                  {record.fromVersion ? `${record.fromVersion} → ` : ''}
                  {record.toVersion ?? '—'} · {formatRelative(record.createdAt)}
                </Text>
              </View>
            ))
          )}
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
      ? colors.accent
      : variant === 'danger'
        ? colors.dangerSoft
        : colors.surface;
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

function Chip({ label }: { label: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText}>{label}</Text>
    </View>
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
    backLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      alignSelf: 'flex-start',
    },
    backLinkText: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: '600',
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      padding: spacing.sm,
      borderWidth: 1,
    },
    bannerError: {
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
    },
    bannerErrorText: {
      flex: 1,
      color: colors.danger,
      fontSize: 12,
    },
    bannerNotice: {
      borderColor: colors.success,
      backgroundColor: colors.successSoft,
    },
    bannerNoticeText: {
      flex: 1,
      color: colors.success,
      fontSize: 12,
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
      width: 52,
      height: 52,
      borderRadius: 17,
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
      fontSize: 14,
      fontWeight: '600',
    },
    heroTrust: {
      color: colors.textMuted,
      fontSize: 11,
    },
    statusPill: {
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    statusPillText: {
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
    },
    trustCopy: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    errorText: {
      color: colors.danger,
      fontSize: 12,
      lineHeight: 17,
    },
    healthText: {
      color: colors.warning,
      fontSize: 11,
      lineHeight: 16,
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
      gap: 5,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
    },
    actionButtonText: {
      fontSize: 11,
      fontWeight: '700',
    },
    coreNote: {
      color: colors.textFaint,
      fontSize: 10,
      lineHeight: 15,
    },
    section: {
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    sectionHint: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
    },
    muted: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    permissionRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.fillSoft,
      padding: spacing.sm,
    },
    permissionText: {
      flex: 1,
      gap: 2,
    },
    permissionLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    permissionDetail: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
    },
    permissionState: {
      fontSize: 10,
      fontWeight: '600',
      marginTop: 2,
    },
    permissionAction: {
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.accent,
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
    },
    permissionActionDanger: {
      borderColor: colors.danger,
    },
    permissionActionText: {
      color: colors.accent,
      fontSize: 10,
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
    chip: {
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.fillSoft,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    chipText: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '600',
    },
    detailGrid: {
      gap: spacing.xs,
      paddingTop: spacing.xs,
    },
    detailRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    detailLabel: {
      width: 90,
      color: colors.textFaint,
      fontSize: 11,
      fontWeight: '600',
    },
    detailValue: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 11,
    },
    activityRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    activityDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      marginTop: 6,
      backgroundColor: colors.accent,
    },
    activityText: {
      flex: 1,
      gap: 1,
    },
    activityTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    activityDetail: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
    },
    activityMeta: {
      color: colors.textFaint,
      fontSize: 9,
      lineHeight: 13,
    },
    historyRow: {
      gap: 1,
      paddingBottom: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: glass.border,
    },
    historyAction: {
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 0.5,
      textTransform: 'uppercase',
    },
    historyDetail: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
    },
    pressed: {
      opacity: 0.78,
    },
    disabled: {
      opacity: 0.5,
    },
  });
