import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { Button } from '@/components/Button';
import { CompanionPairingModal } from '@/components/permissions/CompanionPairingModal';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { formatDateTime, formatRelative } from '@/lib/dates';
import {
  CATEGORY_META,
  RISK_META,
  permissionManager,
  revokeCompanionDevice,
  summarizeAgents,
  type AgentGrantSummary,
  type PermissionAuditEvent,
  type PermissionAuditRecord,
  type PermissionDashboardData,
  type PermissionGrantRecord,
  type PermissionRequestRecord,
  type PermissionRequestStatus,
  type PairedDeviceRecord,
} from '@/lib/permissions';
import { radius, spacing } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;
type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'muted';

const REQUEST_META: Record<
  PermissionRequestStatus,
  { label: string; icon: IconName; tone: Tone }
> = {
  pending: { label: 'Pending', icon: 'time-outline', tone: 'warning' },
  auto_approved: { label: 'Auto-approved', icon: 'flash-outline', tone: 'success' },
  approved_once: { label: 'Allowed once', icon: 'checkmark-outline', tone: 'success' },
  approved_always: { label: 'Always allowed', icon: 'shield-checkmark-outline', tone: 'accent' },
  denied: { label: 'Denied', icon: 'close-circle-outline', tone: 'danger' },
  cancelled: { label: 'Cancelled', icon: 'ban-outline', tone: 'muted' },
  expired: { label: 'Expired', icon: 'hourglass-outline', tone: 'muted' },
  executing: { label: 'Running', icon: 'sync-outline', tone: 'accent' },
  completed: { label: 'Completed', icon: 'checkmark-done-outline', tone: 'success' },
  failed: { label: 'Failed', icon: 'alert-circle-outline', tone: 'danger' },
  blocked: { label: 'Blocked', icon: 'stop-circle-outline', tone: 'danger' },
};

const GRANT_STATUS_META: Record<
  PermissionGrantRecord['status'],
  { label: string; tone: Tone }
> = {
  active: { label: 'ACTIVE', tone: 'success' },
  consumed: { label: 'USED', tone: 'muted' },
  expired: { label: 'EXPIRED', tone: 'muted' },
  revoked: { label: 'REVOKED', tone: 'danger' },
};

const AUDIT_META: Record<
  PermissionAuditEvent,
  { label: string; icon: IconName; tone: Tone }
> = {
  request_created: { label: 'Permission requested', icon: 'help-circle-outline', tone: 'warning' },
  request_auto_approved: { label: 'Auto-approved', icon: 'flash-outline', tone: 'success' },
  approved_once: { label: 'Allowed once', icon: 'checkmark-outline', tone: 'success' },
  approved_always: { label: 'Always allowed', icon: 'shield-checkmark-outline', tone: 'success' },
  denied: { label: 'Denied', icon: 'close-circle-outline', tone: 'danger' },
  cancelled: { label: 'Cancelled', icon: 'ban-outline', tone: 'muted' },
  expired: { label: 'Expired', icon: 'hourglass-outline', tone: 'muted' },
  grant_revoked: { label: 'Grant revoked', icon: 'trash-outline', tone: 'danger' },
  grant_consumed: { label: 'One-time grant used', icon: 'flash-outline', tone: 'accent' },
  execution_authorized: {
    label: 'Execution authorized',
    icon: 'play-circle-outline',
    tone: 'accent',
  },
  execution_completed: {
    label: 'Execution completed',
    icon: 'checkmark-done-outline',
    tone: 'success',
  },
  execution_failed: { label: 'Execution failed', icon: 'alert-circle-outline', tone: 'danger' },
  execution_blocked: { label: 'Execution blocked', icon: 'stop-circle-outline', tone: 'danger' },
  emergency_stop: { label: 'Emergency stop', icon: 'power-outline', tone: 'danger' },
  emergency_resume: { label: 'Permissions resumed', icon: 'play-outline', tone: 'success' },
  device_paired: { label: 'Computer paired', icon: 'desktop-outline', tone: 'accent' },
  device_revoked: { label: 'Computer revoked', icon: 'desktop-outline', tone: 'danger' },
  android_permission_denied: {
    label: 'Android permission denied',
    icon: 'phone-portrait-outline',
    tone: 'danger',
  },
  agent_created: { label: 'Agent created', icon: 'sparkles-outline', tone: 'accent' },
};

function iconOrFallback(name: string): IconName {
  return name in Ionicons.glyphMap ? (name as IconName) : 'shield-outline';
}

function toneColor(tone: Tone, colors: AppTheme['colors']): string {
  if (tone === 'success') {
    return colors.success;
  }

  if (tone === 'danger') {
    return colors.danger;
  }

  if (tone === 'warning') {
    return colors.warning;
  }

  if (tone === 'accent') {
    return colors.accent;
  }

  return colors.textMuted;
}

function toneSoftColor(tone: Tone, colors: AppTheme['colors']): string {
  if (tone === 'success') {
    return colors.successSoft;
  }

  if (tone === 'danger') {
    return colors.dangerSoft;
  }

  if (tone === 'warning') {
    return colors.warningSoft;
  }

  if (tone === 'accent') {
    return colors.accentSoft;
  }

  return colors.surfaceAlt;
}

function grantExpiryLabel(grant: PermissionGrantRecord): string {
  if (grant.status === 'revoked' && grant.revokedAt) {
    return `Revoked ${formatDateTime(grant.revokedAt)}`;
  }

  if (grant.expiresAt === null) {
    return grant.scope === 'once' ? 'Single use' : 'Does not expire';
  }

  if (grant.expiresAt <= Date.now()) {
    return `Expired ${formatDateTime(grant.expiresAt)}`;
  }

  return `Expires ${formatDateTime(grant.expiresAt)}`;
}

function shortFingerprint(value: string): string {
  if (value.length <= 24) {
    return value;
  }

  return `${value.slice(0, 18)}…${value.slice(-6)}`;
}

function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: IconName;
  label: string;
  value: number;
  tone: Tone;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.statTile}>
      <View style={[styles.statIcon, { backgroundColor: toneSoftColor(tone, colors) }]}>
        <Ionicons name={icon} size={16} color={toneColor(tone, colors)} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SectionHeading({
  title,
  caption,
  action,
  onAction,
}: {
  title: string;
  caption?: string;
  action?: string;
  onAction?: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.sectionHeading}>
      <View style={styles.sectionHeadingText}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {caption ? <Text style={styles.sectionCaption}>{caption}</Text> : null}
      </View>
      {action && onAction ? (
        <Pressable
          accessibilityRole="button"
          onPress={onAction}
          style={({ pressed }) => [styles.sectionAction, pressed && styles.pressed]}
        >
          <Text style={styles.sectionActionText}>{action}</Text>
          <Ionicons name="chevron-forward" size={12} color={colors.accent} />
        </Pressable>
      ) : null}
    </View>
  );
}

function EmptyState({ icon, text }: { icon: IconName; text: string }) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={22} color={colors.textFaint} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

function DeviceRow({
  device,
  busy,
  onRevoke,
}: {
  device: PairedDeviceRecord;
  busy: boolean;
  onRevoke: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const paired = device.status === 'paired';

  return (
    <View style={styles.item}>
      <View
        style={[
          styles.itemIcon,
          { backgroundColor: paired ? colors.successSoft : colors.surfaceAlt },
        ]}
      >
        <Ionicons
          name="desktop-outline"
          size={18}
          color={paired ? colors.success : colors.textFaint}
        />
      </View>
      <View style={styles.itemBody}>
        <View style={styles.itemTitleRow}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {device.name}
          </Text>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: paired ? colors.successSoft : colors.dangerSoft },
            ]}
          >
            <Text
              style={[
                styles.statusPillText,
                { color: paired ? colors.success : colors.danger },
              ]}
            >
              {paired ? 'CONNECTED' : device.status.toUpperCase()}
            </Text>
          </View>
        </View>
        <Text style={styles.itemMeta} numberOfLines={1}>
          {device.platform} · {device.endpoint}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          Fingerprint {shortFingerprint(device.fingerprint)}
        </Text>
        <Text style={styles.itemMeta}>
          Paired {formatDateTime(device.pairedAt)}
          {device.lastSeenAt ? ` · seen ${formatRelative(device.lastSeenAt)}` : ' · never used'}
        </Text>
        {device.capabilities.length > 0 ? (
          <Text style={styles.itemMeta} numberOfLines={2}>
            Capabilities: {device.capabilities.join(' · ')}
          </Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Revoke ${device.name}`}
        disabled={busy}
        hitSlop={8}
        onPress={onRevoke}
        style={({ pressed }) => [
          styles.revokeButton,
          pressed && styles.pressed,
          busy && styles.disabled,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.danger} />
        ) : (
          <Ionicons name="trash-outline" size={16} color={colors.danger} />
        )}
      </Pressable>
    </View>
  );
}

function AgentRow({
  entry,
  busy,
  onRevoke,
}: {
  entry: AgentGrantSummary;
  busy: boolean;
  onRevoke: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.item}>
      <View style={[styles.itemIcon, { backgroundColor: colors.accentSoft }]}>
        <Ionicons name={iconOrFallback(entry.agent.icon)} size={18} color={colors.accent} />
      </View>
      <View style={styles.itemBody}>
        <View style={styles.itemTitleRow}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {entry.agent.name}
          </Text>
          <View
            style={[
              styles.statusPill,
              {
                backgroundColor:
                  entry.permissions > 0 ? colors.successSoft : colors.surfaceAlt,
              },
            ]}
          >
            <Text
              style={[
                styles.statusPillText,
                {
                  color: entry.permissions > 0 ? colors.success : colors.textFaint,
                },
              ]}
            >
              {entry.permissions > 0 ? 'AUTHORIZED' : 'NO GRANTS'}
            </Text>
          </View>
        </View>
        <Text style={styles.itemMeta} numberOfLines={2}>
          {entry.agent.description}
        </Text>
        <Text style={styles.itemMeta}>
          {entry.permissions > 0
            ? `${entry.permissions} saved permission${entry.permissions === 1 ? '' : 's'}${
                entry.lastUsedAt ? ` · last used ${formatRelative(entry.lastUsedAt)}` : ' · never used'
              }`
            : 'No saved grants · asks every time'}
        </Text>
      </View>
      {entry.permissions > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Revoke all permissions for ${entry.agent.name}`}
          disabled={busy}
          onPress={onRevoke}
          style={({ pressed }) => [
            styles.smallAction,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <Text style={styles.smallActionText}>Revoke</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function GrantRow({
  grant,
  busy,
  onRevoke,
}: {
  grant: PermissionGrantRecord;
  busy: boolean;
  onRevoke: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const status = GRANT_STATUS_META[grant.status];
  const risk = RISK_META[grant.risk];

  return (
    <View style={styles.item}>
      <View
        style={[
          styles.itemIcon,
          { backgroundColor: toneSoftColor(status.tone, colors) },
        ]}
      >
        <Ionicons
          name={iconOrFallback(CATEGORY_META[grant.category].icon)}
          size={18}
          color={toneColor(status.tone, colors)}
        />
      </View>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle} numberOfLines={2}>
          {grant.title}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          {grant.agentName} · {grant.projectLabel}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          {grant.toolName} · {grant.scope === 'once' ? 'one-time' : 'persistent'}
        </Text>
        <View style={styles.chipRow}>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: toneSoftColor(status.tone, colors) },
            ]}
          >
            <Text style={[styles.statusPillText, { color: toneColor(status.tone, colors) }]}>
              {status.label}
            </Text>
          </View>
          <View
            style={[
              styles.statusPill,
              { backgroundColor: toneSoftColor(risk.colorToken, colors) },
            ]}
          >
            <Text
              style={[
                styles.statusPillText,
                { color: toneColor(risk.colorToken, colors) },
              ]}
            >
              {risk.shortLabel}
            </Text>
          </View>
          <Text style={styles.grantUsage}>
            {grant.useCount} use{grant.useCount === 1 ? '' : 's'}
          </Text>
        </View>
        <Text style={styles.itemMeta}>{grantExpiryLabel(grant)}</Text>
      </View>
      {grant.status === 'active' ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Revoke permission ${grant.title}`}
          disabled={busy}
          onPress={onRevoke}
          style={({ pressed }) => [
            styles.revokeButton,
            pressed && styles.pressed,
            busy && styles.disabled,
          ]}
        >
          {busy ? (
            <ActivityIndicator size="small" color={colors.danger} />
          ) : (
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function RequestRow({ request }: { request: PermissionRequestRecord }) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const meta = REQUEST_META[request.status];

  return (
    <View style={styles.item}>
      <View style={[styles.itemIcon, { backgroundColor: toneSoftColor(meta.tone, colors) }]}>
        <Ionicons name={meta.icon} size={18} color={toneColor(meta.tone, colors)} />
      </View>
      <View style={styles.itemBody}>
        <Text style={styles.itemTitle} numberOfLines={2}>
          {request.title}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          {request.agentName} · {request.projectLabel}
        </Text>
        <Text style={styles.itemMeta}>
          {request.risk.toUpperCase()} risk · {formatRelative(request.createdAt)}
        </Text>
      </View>
      <View
        style={[
          styles.statusPill,
          { backgroundColor: toneSoftColor(meta.tone, colors) },
        ]}
      >
        <Text style={[styles.statusPillText, { color: toneColor(meta.tone, colors) }]}>
          {meta.label}
        </Text>
      </View>
    </View>
  );
}

function AuditRow({ entry }: { entry: PermissionAuditRecord }) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const meta = AUDIT_META[entry.event];

  return (
    <View style={styles.auditRow}>
      <View style={[styles.auditDot, { backgroundColor: toneSoftColor(meta.tone, colors) }]}>
        <Ionicons name={meta.icon} size={12} color={toneColor(meta.tone, colors)} />
      </View>
      <View style={styles.auditBody}>
        <View style={styles.auditTitleRow}>
          <Text style={styles.auditTitle}>{meta.label}</Text>
          <Text style={styles.auditTime}>{formatRelative(entry.createdAt)}</Text>
        </View>
        <Text style={styles.auditDetail}>{entry.detail}</Text>
      </View>
    </View>
  );
}

export default function PermissionsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const [data, setData] = useState<PermissionDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pairingOpen, setPairingOpen] = useState(false);

  const load = useCallback(
    async (spinner: boolean) => {
      if (!user) {
        return;
      }

      if (spinner) {
        setLoading(true);
      }

      try {
        const dashboard = await permissionManager.getDashboard(user.id);
        setData(dashboard);
      } catch (loadError) {
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Agent permissions could not be loaded.'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [user]
  );

  useFocusEffect(
    useCallback(() => {
      void load(false);
    }, [load])
  );

  if (!user) {
    return null;
  }

  const activeUser = user;

  async function runAction(key: string, work: () => Promise<void>) {
    if (busyKey) {
      return;
    }

    setBusyKey(key);
    setError(null);

    try {
      await work();
      await load(false);
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : 'The permission action could not be completed.'
      );
    } finally {
      setBusyKey(null);
    }
  }

  function stopAgents() {
    Alert.alert(
      'Stop all agent actions?',
      'Every pending approval is cancelled and no agent can execute another action until you resume permissions.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop everything',
          style: 'destructive',
          onPress: () => {
            void runAction('emergency-stop', async () => {
              await permissionManager.emergencyStop(activeUser.id);
              setNotice('Emergency stop is active. All pending requests were cancelled.');
            });
          },
        },
      ]
    );
  }

  function resumeAgents() {
    Alert.alert(
      'Resume agent permissions?',
      'Agents will be able to ask for approval again. Saved grants are revalidated before every run.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Resume',
          onPress: () => {
            void runAction('emergency-resume', async () => {
              await permissionManager.resumePermissions(activeUser.id);
              setNotice('Permissions resumed. High-risk actions will still ask every time.');
            });
          },
        },
      ]
    );
  }

  function revokeGrant(grant: PermissionGrantRecord) {
    Alert.alert(
      'Revoke this permission?',
      `${grant.agentName} will need a new approval before using “${grant.title}” again.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            void runAction(`grant-${grant.id}`, async () => {
              const revoked = await permissionManager.revokeGrant(activeUser.id, grant.id);
              setNotice(revoked ? 'The saved permission was revoked.' : 'This grant is no longer active.');
            });
          },
        },
      ]
    );
  }

  function revokeAgent(entry: AgentGrantSummary) {
    Alert.alert(
      `Revoke all permissions for ${entry.agent.name}?`,
      'Every saved grant for this agent is revoked. Other agents keep their own scoped grants.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke all',
          style: 'destructive',
          onPress: () => {
            void runAction(`agent-${entry.agent.id}`, async () => {
              const count = await permissionManager.revokeAgentGrants(
                activeUser.id,
                entry.agent.id
              );
              setNotice(
                `${count} permission${count === 1 ? '' : 's'} revoked for ${entry.agent.name}.`
              );
            });
          },
        },
      ]
    );
  }

  function revokeAllGrants() {
    Alert.alert(
      'Revoke every saved permission?',
      'All agents will need fresh approval for every protected action. One-time grants are included.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke all',
          style: 'destructive',
          onPress: () => {
            void runAction('revoke-all', async () => {
              const count = await permissionManager.revokeAllGrants(activeUser.id);
              setNotice(`${count} saved permission${count === 1 ? '' : 's'} revoked.`);
            });
          },
        },
      ]
    );
  }

  function revokeDevice(device: PairedDeviceRecord) {
    Alert.alert(
      `Revoke ${device.name}?`,
      'The companion session token is deleted immediately. This computer will have to pair again.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            void runAction(`device-${device.id}`, async () => {
              await revokeCompanionDevice(db, activeUser.id, device.id);
              setNotice(`${device.name} was revoked and its session token was deleted.`);
            });
          },
        },
      ]
    );
  }

  const activeGrants = data?.grants.filter((grant) => grant.status === 'active') ?? [];
  const pastGrants =
    data?.grants.filter((grant) => grant.status !== 'active').slice(0, 12) ?? [];
  const devices = data?.devices ?? [];
  const pairedDevices = devices.filter((device) => device.status === 'paired');
  const requests = data?.requests.slice(0, 12) ?? [];
  const audit = data?.audit.slice(0, 20) ?? [];
  const deniedCount =
    data?.requests.filter(
      (request) => request.status === 'denied' || request.status === 'blocked'
    ).length ?? 0;
  const agents = summarizeAgents(data?.grants ?? [], data?.dynamicAgents ?? []);
  const pending = data?.pending.length ?? 0;
  const stopped = data?.emergencyStop ?? false;

  if (loading && !data) {
    return (
      <View style={styles.root}>
        <GlassBackdrop />
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <GlassBackdrop />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load(false);
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
          />
        }
      >
        <ScreenHeader
          eyebrow="AGENT PERMISSIONS"
          title="Control room"
          subtitle="Who can act, on what, and for how long."
          left={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back"
              hitSlop={8}
              onPress={() => {
                if (router.canGoBack()) {
                  router.back();
                } else {
                  router.replace('/settings' as Href);
                }
              }}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <Ionicons name="arrow-back" size={20} color={colors.textMuted} />
            </Pressable>
          }
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open menu"
              hitSlop={8}
              onPress={openSidebar}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
            >
              <Ionicons name="menu" size={20} color={colors.textMuted} />
            </Pressable>
          }
        />

        {error ? (
          <View style={styles.banner}>
            <Ionicons name="alert-circle" size={15} color={colors.danger} />
            <Text style={styles.bannerTextError}>{error}</Text>
          </View>
        ) : null}

        {notice ? (
          <View style={[styles.banner, styles.noticeBanner]}>
            <Ionicons name="checkmark-circle" size={15} color={colors.success} />
            <Text style={styles.bannerTextNotice}>{notice}</Text>
          </View>
        ) : null}

        <GlassView
          style={[
            styles.card,
            styles.emergencyCard,
            stopped ? { borderColor: colors.danger } : null,
          ]}
        >
          <View style={styles.emergencyHeader}>
            <View
              style={[
                styles.emergencyIcon,
                { backgroundColor: stopped ? colors.dangerSoft : colors.successSoft },
              ]}
            >
              <Ionicons
                name="power"
                size={22}
                color={stopped ? colors.danger : colors.success}
              />
            </View>
            <View style={styles.emergencyText}>
              <Text style={styles.emergencyTitle}>
                {stopped ? 'All agents are stopped' : 'Agents can request access'}
              </Text>
              <Text style={styles.emergencyCaption}>
                {stopped
                  ? data?.emergencyStopReason ||
                    'Emergency stop is active. Pending approvals are cancelled.'
                  : 'Every protected action pauses here for your decision. High-risk actions always ask.'}
              </Text>
            </View>
          </View>
          <Button
            label={stopped ? 'Resume permissions' : 'Emergency stop'}
            variant={stopped ? 'primary' : 'danger'}
            onPress={stopped ? resumeAgents : stopAgents}
            loading={busyKey === 'emergency-stop' || busyKey === 'emergency-resume'}
            disabled={busyKey !== null}
          />
        </GlassView>

        <View style={styles.statsGrid}>
          <StatTile
            icon="shield-checkmark-outline"
            label="Active grants"
            value={activeGrants.length}
            tone="success"
          />
          <StatTile
            icon="desktop-outline"
            label="Paired computers"
            value={pairedDevices.length}
            tone="accent"
          />
          <StatTile
            icon="time-outline"
            label="Pending approvals"
            value={pending}
            tone="warning"
          />
          <StatTile
            icon="close-circle-outline"
            label="Denied / blocked"
            value={deniedCount}
            tone="danger"
          />
        </View>

        <SectionHeading
          title="Connected computers"
          caption="Computer access only works through an explicitly paired ORBIT Desktop Companion."
          action={pairingOpen ? undefined : 'Pair'}
          onAction={() => setPairingOpen(true)}
        />

        <GlassView style={styles.card}>
          {devices.length === 0 ? (
            <EmptyState
              icon="desktop-outline"
              text="No computer is paired. Add ORBIT Desktop Companion to run approved work outside this phone."
            />
          ) : (
            devices.map((device, index) => (
              <View key={device.id} style={index > 0 ? styles.divider : undefined}>
                <DeviceRow
                  device={device}
                  busy={busyKey === `device-${device.id}`}
                  onRevoke={() => revokeDevice(device)}
                />
              </View>
            ))
          )}
        </GlassView>

        <SectionHeading
          title="Agents"
          caption="Built-in and dynamic agents. Grants never inherit across agents; revoking one leaves the others untouched."
        />

        <GlassView style={styles.card}>
          {agents.length === 0 ? (
            <EmptyState
              icon="people-outline"
              text="No agents are registered. Built-in agents will appear here as soon as they are available."
            />
          ) : (
            agents.map((entry, index) => (
              <View key={entry.agent.id} style={index > 0 ? styles.divider : undefined}>
                <AgentRow
                  entry={entry}
                  busy={busyKey === `agent-${entry.agent.id}`}
                  onRevoke={() => revokeAgent(entry)}
                />
              </View>
            ))
          )}
        </GlassView>

        <SectionHeading
          title="Active saved grants"
          caption={`${activeGrants.length} grant${activeGrants.length === 1 ? '' : 's'} · persistent grants expire after 30 days`}
          action={activeGrants.length > 1 ? 'Revoke all' : undefined}
          onAction={revokeAllGrants}
        />

        <GlassView style={styles.card}>
          {activeGrants.length === 0 ? (
            <EmptyState
              icon="shield-outline"
              text="No saved grants. Approvals are one-time unless you choose “Always allow” for a low or medium-risk request."
            />
          ) : (
            activeGrants.map((grant, index) => (
              <View key={grant.id} style={index > 0 ? styles.divider : undefined}>
                <GrantRow
                  grant={grant}
                  busy={busyKey === `grant-${grant.id}`}
                  onRevoke={() => revokeGrant(grant)}
                />
              </View>
            ))
          )}
        </GlassView>

        <SectionHeading
          title="Temporary & past grants"
          caption="One-time approvals, expired grants, and revoked history."
        />

        <GlassView style={styles.card}>
          {pastGrants.length === 0 ? (
            <EmptyState
              icon="hourglass-outline"
              text="No temporary or past grants yet. Consumed one-time approvals appear here with their final status."
            />
          ) : (
            pastGrants.map((grant, index) => (
              <View key={grant.id} style={index > 0 ? styles.divider : undefined}>
                <GrantRow
                  grant={grant}
                  busy={busyKey === `grant-${grant.id}`}
                  onRevoke={() => revokeGrant(grant)}
                />
              </View>
            ))
          )}
        </GlassView>

        <SectionHeading
          title="Recent decisions"
          caption="Allow once, Always allow, Deny, cancel, and emergency stop outcomes."
        />

        <GlassView style={styles.card}>
          {requests.length === 0 ? (
            <EmptyState
              icon="receipt-outline"
              text="No permission decisions yet. The next protected tool call will appear here."
            />
          ) : (
            requests.map((request, index) => (
              <View key={request.id} style={index > 0 ? styles.divider : undefined}>
                <RequestRow request={request} />
              </View>
            ))
          )}
        </GlassView>

        <SectionHeading
          title="Audit history"
          caption="Redacted, append-only consent and execution events."
        />

        <GlassView style={styles.card}>
          {audit.length === 0 ? (
            <EmptyState
              icon="document-text-outline"
              text="No audit entries yet. Requests, grants, revocations, and executions are recorded here."
            />
          ) : (
            audit.map((entry, index) => (
              <View key={entry.id} style={index > 0 ? styles.divider : undefined}>
                <AuditRow entry={entry} />
              </View>
            ))
          )}
        </GlassView>

        <View style={styles.footerRow}>
          <Ionicons name="lock-closed-outline" size={13} color={colors.textFaint} />
          <Text style={styles.footer}>
            Secrets, tokens, and passwords are redacted before permission text reaches SQLite,
            chat, or this screen.
          </Text>
        </View>
      </ScrollView>

      <CompanionPairingModal
        visible={pairingOpen}
        userId={activeUser.id}
        onClose={() => setPairingOpen(false)}
        onPaired={(device) => {
          setPairingOpen(false);
          setNotice(
            `Paired ${device.name}. Computer commands still require approval before execution.`
          );
          void load(false);
        }}
      />
    </View>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: {
      flexGrow: 1,
      paddingHorizontal: spacing.lg,
    },
    backButton: {
      width: 40,
      height: 40,
      borderRadius: 13,
      backgroundColor: glass.fillStrong,
      borderWidth: 1,
      borderColor: glass.border,
      borderTopColor: glass.borderBright,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: 'rgba(255, 107, 122, 0.28)',
      borderTopColor: glass.borderBright,
      backgroundColor: colors.dangerSoft,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      marginTop: spacing.lg,
    },
    noticeBanner: {
      borderColor: 'rgba(62, 224, 161, 0.28)',
      backgroundColor: colors.successSoft,
    },
    bannerTextError: {
      flex: 1,
      color: colors.danger,
      fontSize: 13,
      lineHeight: 19,
    },
    bannerTextNotice: {
      flex: 1,
      color: colors.success,
      fontSize: 13,
      lineHeight: 19,
    },
    card: {
      padding: spacing.md,
      marginTop: spacing.sm,
    },
    emergencyCard: {
      marginTop: spacing.lg,
      gap: spacing.md,
    },
    emergencyHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
    },
    emergencyIcon: {
      width: 46,
      height: 46,
      borderRadius: 15,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emergencyText: {
      flex: 1,
      gap: 3,
    },
    emergencyTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    emergencyCaption: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      marginTop: spacing.md,
    },
    statTile: {
      flexGrow: 1,
      flexBasis: '46%',
      gap: 3,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: glass.border,
      borderTopColor: glass.borderBright,
      backgroundColor: glass.fill,
      padding: spacing.md,
    },
    statIcon: {
      width: 30,
      height: 30,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 3,
    },
    statValue: {
      color: colors.text,
      fontSize: 23,
      fontWeight: '700',
      letterSpacing: -0.5,
    },
    statLabel: {
      color: colors.textMuted,
      fontSize: 11,
    },
    sectionHeading: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      justifyContent: 'space-between',
      gap: spacing.sm,
      marginTop: spacing.xl,
    },
    sectionHeadingText: {
      flex: 1,
      gap: 2,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
      letterSpacing: -0.2,
    },
    sectionCaption: {
      color: colors.textFaint,
      fontSize: 11,
      lineHeight: 16,
    },
    sectionAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingVertical: 4,
    },
    sectionActionText: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: '600',
    },
    empty: {
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.md,
    },
    emptyText: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
      textAlign: 'center',
    },
    item: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm + 2,
      paddingVertical: spacing.sm + 2,
    },
    divider: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    itemIcon: {
      width: 38,
      height: 38,
      borderRadius: 13,
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemBody: {
      flex: 1,
      gap: 3,
    },
    itemTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    itemTitle: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      lineHeight: 19,
    },
    itemMeta: {
      color: colors.textFaint,
      fontSize: 11,
      lineHeight: 15,
    },
    statusPill: {
      alignSelf: 'flex-start',
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 3,
    },
    statusPillText: {
      fontSize: 8,
      fontWeight: '800',
      letterSpacing: 0.8,
    },
    revokeButton: {
      width: 34,
      height: 34,
      borderRadius: 11,
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: 'rgba(255, 107, 122, 0.22)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    smallAction: {
      minWidth: 58,
      height: 30,
      borderRadius: 10,
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: 'rgba(255, 107, 122, 0.22)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
    },
    smallActionText: {
      color: colors.danger,
      fontSize: 10,
      fontWeight: '700',
    },
    chipRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
      marginTop: 1,
    },
    grantUsage: {
      color: colors.textFaint,
      fontSize: 10,
    },
    auditRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingVertical: spacing.sm,
    },
    auditDot: {
      width: 26,
      height: 26,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
    },
    auditBody: {
      flex: 1,
      gap: 2,
    },
    auditTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    auditTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    auditTime: {
      color: colors.textFaint,
      fontSize: 10,
    },
    auditDetail: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
    },
    footerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.xs,
      marginTop: spacing.xl,
      paddingHorizontal: spacing.xs,
    },
    footer: {
      flex: 1,
      color: colors.textFaint,
      fontSize: 10,
      lineHeight: 15,
    },
    pressed: {
      opacity: 0.78,
    },
    disabled: {
      opacity: 0.5,
    },
  });
