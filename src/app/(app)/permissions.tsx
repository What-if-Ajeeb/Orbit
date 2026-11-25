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

import { Button } from '@/components/Button';
import { CompanionPairingModal } from '@/components/permissions/CompanionPairingModal';
import { EmptyState } from '@/components/EmptyState';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SettingsNavRow } from '@/components/SettingsNavRow';
import { SettingsSection } from '@/components/SettingsSection';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
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
  type PermissionDenialRecord,
  type PermissionGrantRecord,
  type PermissionPreferenceRecord,
  type PermissionRequestRecord,
  type PermissionRequestStatus,
  type PairedDeviceRecord,
} from '@/lib/permissions';
import { SafetyTrash } from '@/lib/safety/trash';
import type { ActivityRecord, ActiveOperation } from '@/lib/safety/types';
import { layout, radius, spacing, typography } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;
type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'muted';
type Tab = 'overview' | 'activity' | 'grants' | 'audit';

const REQUEST_META: Record<
  PermissionRequestStatus,
  { label: string; icon: IconName; tone: Tone }
> = {
  pending: { label: 'Pending', icon: 'time-outline', tone: 'warning' },
  auto_approved: { label: 'Auto-approved', icon: 'flash-outline', tone: 'success' },
  approved_once: { label: 'Allowed once', icon: 'checkmark-outline', tone: 'success' },
  approved_session: { label: 'Allowed for session', icon: 'hourglass-outline', tone: 'accent' },
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
  active: { label: 'Active', tone: 'success' },
  consumed: { label: 'Used', tone: 'muted' },
  expired: { label: 'Expired', tone: 'muted' },
  revoked: { label: 'Revoked', tone: 'danger' },
};

const AUDIT_META: Record<
  PermissionAuditEvent,
  { label: string; icon: IconName; tone: Tone }
> = {
  request_created: { label: 'Permission requested', icon: 'help-circle-outline', tone: 'warning' },
  request_auto_approved: { label: 'Auto-approved', icon: 'flash-outline', tone: 'success' },
  approved_once: { label: 'Allowed once', icon: 'checkmark-outline', tone: 'success' },
  approved_session: {
    label: 'Allowed for session',
    icon: 'hourglass-outline',
    tone: 'accent',
  },
  approved_always: { label: 'Always allowed', icon: 'shield-checkmark-outline', tone: 'success' },
  ask_every_time: { label: 'Ask every time', icon: 'help-circle-outline', tone: 'warning' },
  never_allowed: { label: 'Never allowed', icon: 'ban-outline', tone: 'danger' },
  denied: { label: 'Denied', icon: 'close-circle-outline', tone: 'danger' },
  cancelled: { label: 'Cancelled', icon: 'ban-outline', tone: 'muted' },
  agent_stopped: { label: 'Agent stopped', icon: 'stop-circle-outline', tone: 'danger' },
  agent_resumed: { label: 'Agent resumed', icon: 'play-outline', tone: 'success' },
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

const ACTIVITY_META: Record<
  ActivityRecord['status'],
  { label: string; icon: IconName; tone: Tone }
> = {
  running: { label: 'Running', icon: 'sync-outline', tone: 'accent' },
  pending: { label: 'Awaiting approval', icon: 'time-outline', tone: 'warning' },
  approved: { label: 'Approved, awaiting execution', icon: 'checkmark-outline', tone: 'accent' },
  success: { label: 'Completed', icon: 'checkmark-circle-outline', tone: 'success' },
  denied: { label: 'Denied', icon: 'close-circle-outline', tone: 'danger' },
  failed: { label: 'Failed', icon: 'alert-circle-outline', tone: 'danger' },
  cancelled: { label: 'Cancelled', icon: 'ban-outline', tone: 'muted' },
  stopped: { label: 'Stopped', icon: 'stop-circle-outline', tone: 'warning' },
  blocked: { label: 'Blocked', icon: 'shield-outline', tone: 'danger' },
  unknown: { label: 'Unconfirmed', icon: 'help-circle-outline', tone: 'warning' },
  restored: { label: 'Restored', icon: 'refresh-outline', tone: 'success' },
};

const OPERATION_TONES: Record<ActiveOperation['status'], Tone> = {
  running: 'accent',
  cancelling: 'warning',
  stopped: 'warning',
  completed: 'success',
  failed: 'danger',
  unknown: 'muted',
};

function iconOrFallback(name: string): IconName {
  return name in Ionicons.glyphMap ? (name as IconName) : 'shield-outline';
}

function statusTone(tone: Tone): StatusTone {
  return tone === 'muted' ? 'neutral' : tone;
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

function grantScopeLabel(scope: PermissionGrantRecord['scope']): string {
  if (scope === 'once') {
    return 'One-time approval';
  }

  if (scope === 'session') {
    return 'This app session';
  }

  return 'Saved approval';
}

function shortFingerprint(value: string): string {
  if (value.length <= 24) {
    return value;
  }

  return `${value.slice(0, 18)}…${value.slice(-6)}`;
}

function trashIdFor(entry: ActivityRecord): string | null {
  const trashId = entry.metadata.trashId;
  return typeof trashId === 'string' ? trashId : null;
}

function preferenceIdentity(preference: PermissionPreferenceRecord): string {
  return [
    preference.agentId,
    preference.toolName,
    preference.scopeKey,
    preference.resourceKey,
  ].join('|');
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
        <Ionicons name={icon} size={15} color={toneColor(tone, colors)} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function SectionAction({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.sectionAction, pressed && styles.pressed]}
    >
      <Text style={styles.sectionActionText}>{label}</Text>
      <Ionicons name="chevron-forward" size={13} color={colors.accent} />
    </Pressable>
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
  const tone: Tone = paired ? 'success' : device.status === 'revoked' ? 'danger' : 'muted';

  return (
    <View style={styles.item}>
      <View style={[styles.itemIcon, { backgroundColor: toneSoftColor(tone, colors) }]}>
        <Ionicons
          name="desktop-outline"
          size={18}
          color={toneColor(tone, colors)}
        />
      </View>
      <View style={styles.itemBody}>
        <View style={styles.itemTitleRow}>
          <Text style={styles.itemTitle} numberOfLines={1}>
            {device.name}
          </Text>
          <StatusPill
            label={paired ? 'Connected' : device.status === 'revoked' ? 'Revoked' : 'Offline'}
            tone={statusTone(tone)}
            showDot
          />
        </View>
        <Text style={styles.itemMeta} numberOfLines={1}>
          {device.platform} · {device.endpoint}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          Fingerprint {shortFingerprint(device.fingerprint)}
        </Text>
        <Text style={styles.itemMeta}>
          Paired {formatDateTime(device.pairedAt)}
          {device.lastSeenAt ? ` · last seen ${formatRelative(device.lastSeenAt)}` : ' · never used'}
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
  capabilities,
  lastActivity,
  pendingApprovals,
  busy,
  onRevoke,
}: {
  entry: AgentGrantSummary;
  capabilities: string[];
  lastActivity: number | null;
  pendingApprovals: number;
  busy: boolean;
  onRevoke: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const authorized = entry.permissions > 0;
  const roleLabel = entry.agent.role.charAt(0).toUpperCase() + entry.agent.role.slice(1);

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
          <StatusPill
            label={authorized ? `${entry.permissions} grant${entry.permissions === 1 ? '' : 's'}` : 'No grants'}
            tone={authorized ? 'success' : 'neutral'}
            showDot={authorized}
          />
        </View>
        <Text style={styles.itemMeta} numberOfLines={2}>
          {roleLabel} · {entry.agent.description}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={2}>
          {capabilities.length > 0
            ? `Capability scope: ${capabilities.slice(0, 3).join(' · ')}${capabilities.length > 3 ? ` · +${capabilities.length - 3}` : ''}`
            : 'Capability scope: none saved'}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          {entry.lastUsedAt
            ? `Last grant used ${formatRelative(entry.lastUsedAt)}`
            : 'No saved grant used yet'}
          {lastActivity ? ` · Last activity ${formatRelative(lastActivity)}` : ''}
        </Text>
        {pendingApprovals > 0 ? (
          <StatusPill
            label={`${pendingApprovals} awaiting approval`}
            tone="warning"
            icon="time-outline"
            style={styles.inlinePill}
          />
        ) : null}
      </View>
      {authorized ? (
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
            <Text style={styles.smallActionText}>Revoke all</Text>
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
  const riskTone: Tone = RISK_META[grant.risk].colorToken;

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
        <View style={styles.itemTitleRow}>
          <Text style={styles.itemTitle} numberOfLines={2}>
            {grant.title}
          </Text>
          <StatusPill label={status.label} tone={statusTone(status.tone)} showDot />
        </View>
        <Text style={styles.itemMeta} numberOfLines={1}>
          Agent: {grant.agentName} · Project: {grant.projectLabel}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          Capability: {CATEGORY_META[grant.category].label} · Tool: {grant.toolName}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          Scope: {grantScopeLabel(grant.scope)} · Resource: {grant.resourceKey}
        </Text>
        <View style={styles.chipRow}>
          <StatusPill
            label={RISK_META[grant.risk].shortLabel}
            tone={statusTone(riskTone)}
            icon="shield-outline"
          />
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
  const riskTone: Tone = RISK_META[request.risk].colorToken;

  return (
    <View style={styles.item}>
      <View style={[styles.itemIcon, { backgroundColor: toneSoftColor(meta.tone, colors) }]}>
        <Ionicons name={meta.icon} size={18} color={toneColor(meta.tone, colors)} />
      </View>
      <View style={styles.itemBody}>
        <View style={styles.itemTitleRow}>
          <Text style={styles.itemTitle} numberOfLines={2}>
            {request.title}
          </Text>
          <StatusPill label={meta.label} tone={statusTone(meta.tone)} showDot />
        </View>
        <Text style={styles.itemMeta} numberOfLines={1}>
          Agent: {request.agentName} · Project: {request.projectLabel}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          Capability: {CATEGORY_META[request.category].label} · Tool: {request.toolName}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          Resource: {request.resourceKey} · {formatRelative(request.createdAt)}
        </Text>
        <View style={styles.chipRow}>
          <StatusPill
            label={RISK_META[request.risk].shortLabel}
            tone={statusTone(riskTone)}
            icon="shield-outline"
          />
        </View>
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
      {entry.risk ? (
        <StatusPill
          label={RISK_META[entry.risk].label}
          tone={RISK_META[entry.risk].colorToken}
        />
      ) : null}
    </View>
  );
}

function ActivityRow({
  entry,
  restoring,
  onRestore,
}: {
  entry: ActivityRecord;
  restoring: boolean;
  onRestore: (trashId: string) => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const meta = ACTIVITY_META[entry.status];
  const outcome = entry.error || entry.result;
  const trashId = trashIdFor(entry);

  return (
    <View style={styles.item}>
      <View style={[styles.itemIcon, { backgroundColor: toneSoftColor(meta.tone, colors) }]}>
        <Ionicons name={meta.icon} size={18} color={toneColor(meta.tone, colors)} />
      </View>
      <View style={styles.itemBody}>
        <View style={styles.itemTitleRow}>
          <Text style={styles.itemTitle} numberOfLines={2}>
            {entry.action}
          </Text>
          <StatusPill label={meta.label} tone={statusTone(meta.tone)} showDot />
        </View>
        <Text style={styles.itemMeta} numberOfLines={1}>
          {formatDateTime(entry.createdAt)} · Agent: {entry.agentName} · {entry.toolName}
        </Text>
        {entry.resourceLabel ? (
          <Text style={styles.itemMeta} numberOfLines={1}>
            Resource: {entry.resourceLabel}
          </Text>
        ) : null}
        <View style={styles.chipRow}>
          <StatusPill label={entry.permissionUsed || 'No permission used'} tone="neutral" />
          {entry.external ? (
            <StatusPill label="External" tone="warning" icon="cloud-outline" />
          ) : null}
          {entry.reversible ? (
            <StatusPill label="Reversible" tone="success" icon="refresh-outline" />
          ) : null}
        </View>
        {outcome ? (
          <Text style={[styles.itemMeta, entry.error ? styles.dangerText : undefined]} numberOfLines={2}>
            {outcome}
          </Text>
        ) : null}
        {trashId && entry.status !== 'restored' ? (
          <Pressable
            onPress={() => onRestore(trashId)}
            disabled={restoring}
            style={styles.restoreButton}
            accessibilityRole="button"
          >
            {restoring ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ionicons name="refresh-outline" size={14} color={colors.accent} />
            )}
            <Text style={styles.restoreText}>
              {restoring ? 'Restoring…' : 'Restore original'}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function OperationRow({
  operation,
  busy,
  onStop,
}: {
  operation: ActiveOperation;
  busy: boolean;
  onStop: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const tone = OPERATION_TONES[operation.status];

  return (
    <View style={styles.item}>
      <View style={[styles.itemIcon, { backgroundColor: toneSoftColor(tone, colors) }]}>
        <Ionicons name="sync-outline" size={18} color={toneColor(tone, colors)} />
      </View>
      <View style={styles.itemBody}>
        <View style={styles.itemTitleRow}>
          <Text style={styles.itemTitle} numberOfLines={2}>
            {operation.detail}
          </Text>
          <StatusPill
            label={operation.status.charAt(0).toUpperCase() + operation.status.slice(1)}
            tone={statusTone(tone)}
            showDot
          />
        </View>
        <Text style={styles.itemMeta} numberOfLines={1}>
          Agent: {operation.agentName} · Tool: {operation.toolName}
        </Text>
        <View style={styles.chipRow}>
          <StatusPill
            label={operation.cancellable ? 'Cancellable' : 'Cannot be cancelled'}
            tone={operation.cancellable ? 'info' : 'warning'}
          />
          {operation.external ? (
            <StatusPill
              label="External result may persist"
              tone="warning"
              icon="alert-circle-outline"
            />
          ) : null}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Stop ${operation.toolName}`}
        disabled={busy}
        onPress={onStop}
        style={({ pressed }) => [
          styles.revokeButton,
          pressed && styles.pressed,
          busy && styles.disabled,
        ]}
      >
        {busy ? (
          <ActivityIndicator size="small" color={colors.danger} />
        ) : (
          <Ionicons name="stop-circle-outline" size={16} color={colors.danger} />
        )}
      </Pressable>
    </View>
  );
}

function SavedChoiceRow({
  denial,
  preference,
  busy,
  onRevoke,
}: {
  denial?: PermissionDenialRecord;
  preference?: PermissionPreferenceRecord;
  busy: boolean;
  onRevoke: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const entry = denial ?? preference;

  if (!entry) {
    return null;
  }

  const label = denial ? 'Never allow' : 'Ask every time';
  const tone: Tone = denial ? 'danger' : 'warning';

  return (
    <View style={styles.item}>
      <View style={[styles.itemIcon, { backgroundColor: toneSoftColor(tone, colors) }]}>
        <Ionicons
          name={denial ? 'ban-outline' : 'help-circle-outline'}
          size={18}
          color={toneColor(tone, colors)}
        />
      </View>
      <View style={styles.itemBody}>
        <View style={styles.itemTitleRow}>
          <Text style={styles.itemTitle} numberOfLines={2}>
            {label}
          </Text>
          <StatusPill label="Saved choice" tone={statusTone(tone)} />
        </View>
        <Text style={styles.itemMeta} numberOfLines={1}>
          Agent: {entry.agentId} · Tool: {entry.toolName}
        </Text>
        <Text style={styles.itemMeta} numberOfLines={1}>
          Scope: {entry.scopeKey} · Resource: {entry.resourceKey}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Revoke ${label}`}
        disabled={busy}
        onPress={onRevoke}
        style={({ pressed }) => [
          styles.revokeButton,
          pressed && styles.pressed,
          busy && styles.disabled,
        ]}
      >
        <Ionicons name="trash-outline" size={16} color={colors.danger} />
      </Pressable>
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
  const [tab, setTab] = useState<Tab>('overview');

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

  function restoreTrash(trashId: string) {
    void runAction(`restore-${trashId}`, async () => {
      const item = await new SafetyTrash(db).restore({
        userId: activeUser.id,
        agentId: 'user',
        agentName: 'You',
        id: trashId,
      });
      setNotice(`Restored ${item.name} to ${item.originalPath}.`);
    });
  }

  function stopAgents() {
    Alert.alert(
      'Stop all agent actions?',
      'Every pending approval is cancelled and no agent can execute another action until you resume permissions. Running work receives a cancellation signal; external actions may already have completed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop everything',
          style: 'destructive',
          onPress: () => {
            void runAction('emergency-stop', async () => {
              await permissionManager.emergencyStop(activeUser.id);
              const report = permissionManager.getStopReport();
              const stopRequested = report?.stopRequested.length ?? 0;
              const cancelledRequests = report?.cancelledRequests ?? 0;
              const revokedGrants = report?.revokedGrants ?? 0;
              const uncancellable = report?.uncancellable.length ?? 0;
              setNotice(
                `Emergency stop is active. Stop requested for ${stopRequested} operation${stopRequested === 1 ? '' : 's'}; cancelled ${cancelledRequests} pending request${cancelledRequests === 1 ? '' : 's'}; revoked ${revokedGrants} grant${revokedGrants === 1 ? '' : 's'}.` +
                  (uncancellable > 0
                    ? ` ${uncancellable} operation${uncancellable === 1 ? '' : 's'} could not be cancelled and may have completed outside ORBIT.`
                    : '')
              );
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

  function revokeSavedChoice(denial?: PermissionDenialRecord, preference?: PermissionPreferenceRecord) {
    Alert.alert(
      'Revoke this saved choice?',
      'The exact action can be requested again. Nothing has been executed by revoking it.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Revoke',
          style: 'destructive',
          onPress: () => {
            void runAction(`choice-${denial?.id ?? (preference ? preferenceIdentity(preference) : 'preference')}`, async () => {
              const removed = denial
                ? await permissionManager.revokeDenial(activeUser.id, denial.id)
                : preference
                  ? await permissionManager.revokePreference(activeUser.id, preference)
                  : false;
              setNotice(removed ? 'The saved choice was revoked.' : 'This choice is no longer active.');
            });
          },
        },
      ]
    );
  }

  function stopOperation(operation: ActiveOperation) {
    Alert.alert(
      'Stop this operation?',
      operation.external
        ? 'ORBIT will stop waiting, but the external service may already have completed the action. Check the service before retrying.'
        : operation.cancellable
          ? 'The running tool will receive a cancellation signal immediately.'
          : 'This operation is already uncancellable. ORBIT will mark its result as unconfirmed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Stop',
          style: 'destructive',
          onPress: () => {
            void runAction(`operation-${operation.id}`, async () => {
              const result = await permissionManager.cancelOperation(activeUser.id, operation.id);
              setNotice(result.message);
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
  const activity = data?.activity.slice(0, 12) ?? [];
  const activeOperations = data?.activeOperations ?? [];
  const denials = data?.denials ?? [];
  const preferences = data?.preferences ?? [];
  const savedChoices: {
    key: string;
    denial?: PermissionDenialRecord;
    preference?: PermissionPreferenceRecord;
  }[] = [
    ...denials.map((denial) => ({ key: denial.id, denial })),
    ...preferences.map((preference) => ({
      key: preferenceIdentity(preference),
      preference,
    })),
  ];
  const deniedCount =
    data?.requests.filter(
      (request) => request.status === 'denied' || request.status === 'blocked'
    ).length ?? 0;
  const agents = summarizeAgents(data?.grants ?? [], data?.dynamicAgents ?? []);

  const agentCapabilities = new Map<string, string[]>();
  const agentLastActivity = new Map<string, number>();
  const agentPending = new Map<string, number>();

  for (const grant of data?.grants ?? []) {
    if (grant.status !== 'active') {
      continue;
    }

    const labels = agentCapabilities.get(grant.agentId) ?? [];
    const label = CATEGORY_META[grant.category].shortLabel;

    if (!labels.includes(label)) {
      labels.push(label);
    }

    agentCapabilities.set(grant.agentId, labels);
  }

  for (const entry of data?.activity ?? []) {
    if (!agentLastActivity.has(entry.agentId)) {
      agentLastActivity.set(entry.agentId, entry.createdAt);
    }
  }

  for (const request of data?.pending ?? []) {
    agentPending.set(request.agentId, (agentPending.get(request.agentId) ?? 0) + 1);
  }

  const pending = data?.pending.length ?? 0;
  const stopped = data?.emergencyStop ?? false;

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'activity', label: 'Activity', count: activity.length },
    { key: 'grants', label: 'Grants', count: activeGrants.length },
    { key: 'audit', label: 'Audit' },
  ];

  if (loading && !data) {
    return (
      <View style={styles.root}>
        <GlassBackdrop />
        <View style={[styles.loading, { paddingTop: insets.top }]}>
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
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.xl,
          },
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
          title="Safety dashboard"
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
                  router.navigate('/settings' as Href);
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
              <View style={styles.inlineRow}>
                <Text style={styles.emergencyTitle}>
                  {stopped ? 'All agents are stopped' : 'Agents can request access'}
                </Text>
                <StatusPill
                  label={stopped ? 'Stopped' : 'Active'}
                  tone={stopped ? 'danger' : 'success'}
                  showDot
                />
              </View>
              <Text style={styles.emergencyCaption}>
                {stopped
                  ? data?.emergencyStopReason ||
                    'Emergency stop is active. Pending approvals are cancelled.'
                  : 'Every protected action pauses here for your decision. High-risk actions always ask.'}
              </Text>
              {stopped && data?.stoppedAgents.length ? (
                <Text style={styles.emergencyCaption}>
                  Stopped agents: {data.stoppedAgents.join(', ')}
                </Text>
              ) : null}
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

        <View accessibilityRole="tablist" style={styles.segmented}>
          {tabs.map((option) => {
            const active = tab === option.key;

            return (
              <Pressable
                key={option.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(option.key)}
                style={[styles.segment, active && styles.segmentActive]}
              >
                <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                  {option.label}
                </Text>
                {option.count ? (
                  <View style={[styles.segmentCount, active && styles.segmentCountActive]}>
                    <Text style={[styles.segmentCountText, active && styles.segmentCountTextActive]}>
                      {option.count}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>

        {tab === 'overview' ? (
          <>
            <SettingsSection
              title="Connected tools & computers"
              description="Computer access only works through an explicitly paired ORBIT Desktop Companion. Connected tools stay permission-scoped."
              action={<SectionAction label="Pair" onPress={() => setPairingOpen(true)} />}
            >
              <GlassView style={styles.card}>
                {devices.length === 0 ? (
                  <EmptyState
                    icon="desktop-outline"
                    title="No paired computers"
                    message="Add ORBIT Desktop Companion to run approved work outside this phone."
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
            </SettingsSection>

            <SettingsSection
              title="Agents"
              description="Built-in and dynamic agents. Grants never inherit across agents; revoking one leaves the others untouched."
            >
              <GlassView style={styles.card}>
                {agents.length === 0 ? (
                  <EmptyState
                    icon="people-outline"
                    title="No agents registered"
                    message="Built-in agents will appear here as soon as they are available."
                  />
                ) : (
                  agents.map((entry, index) => (
                    <View key={entry.agent.id} style={index > 0 ? styles.divider : undefined}>
                      <AgentRow
                        entry={entry}
                        capabilities={agentCapabilities.get(entry.agent.id) ?? []}
                        lastActivity={agentLastActivity.get(entry.agent.id) ?? null}
                        pendingApprovals={agentPending.get(entry.agent.id) ?? 0}
                        busy={busyKey === `agent-${entry.agent.id}`}
                        onRevoke={() => revokeAgent(entry)}
                      />
                    </View>
                  ))
                )}
              </GlassView>
            </SettingsSection>

            <SettingsSection
              title="Active operations"
              description="Running tool calls with real cancellation states. External actions may complete even after a stop."
            >
              <GlassView style={styles.card}>
                {activeOperations.length === 0 ? (
                  <EmptyState
                    icon="sync-outline"
                    title="No active operations"
                    message="No tool call is running right now."
                  />
                ) : (
                  activeOperations.map((operation, index) => (
                    <View key={operation.id} style={index > 0 ? styles.divider : undefined}>
                      <OperationRow
                        operation={operation}
                        busy={busyKey === `operation-${operation.id}`}
                        onStop={() => stopOperation(operation)}
                      />
                    </View>
                  ))
                )}
              </GlassView>
            </SettingsSection>

            <SettingsSection
              title="More details"
              description="Review decisions, saved approvals, and the append-only audit trail."
            >
              <GlassView style={styles.card}>
                <SettingsNavRow
                  icon="receipt-outline"
                  title="Activity & decisions"
                  description="Recent decisions and timestamped agent activity."
                  badge={`${activity.length}`}
                  onPress={() => setTab('activity')}
                />
                <View style={styles.divider} />
                <SettingsNavRow
                  icon="shield-checkmark-outline"
                  title="Grants & saved choices"
                  description="Active, temporary, and past grants with revoke controls."
                  badge={`${activeGrants.length}`}
                  onPress={() => setTab('grants')}
                />
                <View style={styles.divider} />
                <SettingsNavRow
                  icon="document-text-outline"
                  title="Audit history"
                  description="Consent and execution events."
                  onPress={() => setTab('audit')}
                />
              </GlassView>
            </SettingsSection>
          </>
        ) : null}

        {tab === 'activity' ? (
          <>
            <SettingsSection
              title="Recent decisions"
              description="Allow once, Always allow, Deny, cancel, and emergency stop outcomes."
            >
              <GlassView style={styles.card}>
                {requests.length === 0 ? (
                  <EmptyState
                    icon="receipt-outline"
                    title="No decisions yet"
                    message="The next protected tool call will appear here."
                  />
                ) : (
                  requests.map((request, index) => (
                    <View key={request.id} style={index > 0 ? styles.divider : undefined}>
                      <RequestRow request={request} />
                    </View>
                  ))
                )}
              </GlassView>
            </SettingsSection>

            <SettingsSection
              title="Agent activity"
              description="Timestamp, agent, action, resource, permission used, status, and the real result or error."
            >
              <GlassView style={styles.card}>
                {activity.length === 0 ? (
                  <EmptyState
                    icon="receipt-outline"
                    title="No activity yet"
                    message="Requests, approvals, denials, and execution results appear here."
                  />
                ) : (
                  activity.map((entry, index) => (
                    <View key={entry.id} style={index > 0 ? styles.divider : undefined}>
                      <ActivityRow
                        entry={entry}
                        restoring={busyKey === `restore-${trashIdFor(entry) ?? ''}`}
                        onRestore={restoreTrash}
                      />
                    </View>
                  ))
                )}
              </GlassView>
            </SettingsSection>
          </>
        ) : null}

        {tab === 'grants' ? (
          <>
            <SettingsSection
              title="Active saved grants"
              description="Persistent grants expire after 30 days. Every grant stays scoped to its agent, tool, and resource."
              action={
                activeGrants.length > 1 ? (
                  <SectionAction label="Revoke all" onPress={revokeAllGrants} />
                ) : undefined
              }
            >
              <GlassView style={styles.card}>
                {activeGrants.length === 0 ? (
                  <EmptyState
                    icon="shield-outline"
                    title="No saved grants"
                    message="Approvals are one-time unless you choose “Always allow” for a low or medium-risk request."
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
            </SettingsSection>

            <SettingsSection
              title="Temporary & past grants"
              description="One-time approvals, expired grants, and revoked history."
            >
              <GlassView style={styles.card}>
                {pastGrants.length === 0 ? (
                  <EmptyState
                    icon="hourglass-outline"
                    title="No past grants"
                    message="Consumed one-time approvals appear here with their final status."
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
            </SettingsSection>

            <SettingsSection
              title="Saved choices"
              description="Never Allow and Ask Every Time are exact-scope decisions. Revoke them to allow a new request."
            >
              <GlassView style={styles.card}>
                {savedChoices.length === 0 ? (
                  <EmptyState
                    icon="options-outline"
                    title="No saved choices"
                    message="Every protected action will be asked about until you choose one."
                  />
                ) : (
                  savedChoices.map(({ key, denial, preference }, index) => (
                    <View key={key} style={index > 0 ? styles.divider : undefined}>
                      <SavedChoiceRow
                        denial={denial}
                        preference={preference}
                        busy={
                          busyKey ===
                          `choice-${denial?.id ?? (preference ? preferenceIdentity(preference) : 'preference')}`
                        }
                        onRevoke={() => revokeSavedChoice(denial, preference)}
                      />
                    </View>
                  ))
                )}
              </GlassView>
            </SettingsSection>
          </>
        ) : null}

        {tab === 'audit' ? (
          <SettingsSection
            title="Audit history"
            description="Redacted, append-only consent and execution events."
          >
            <GlassView style={styles.card}>
              {audit.length === 0 ? (
                <EmptyState
                  icon="document-text-outline"
                  title="No audit entries yet"
                  message="Requests, grants, revocations, and executions are recorded here."
                />
              ) : (
                audit.map((entry, index) => (
                  <View key={entry.id} style={index > 0 ? styles.divider : undefined}>
                    <AuditRow entry={entry} />
                  </View>
                ))
              )}
            </GlassView>
          </SettingsSection>
        ) : null}

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
      width: layout.iconButton,
      height: layout.iconButton,
      borderRadius: radius.md,
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
      borderColor: `${colors.danger}47`,
      borderTopColor: glass.borderBright,
      backgroundColor: colors.dangerSoft,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      marginTop: spacing.lg,
    },
    noticeBanner: {
      borderColor: `${colors.success}47`,
      backgroundColor: colors.successSoft,
    },
    bannerTextError: {
      flex: 1,
      color: colors.danger,
      ...typography.bodySmall,
    },
    bannerTextNotice: {
      flex: 1,
      color: colors.success,
      ...typography.bodySmall,
    },
    card: {
      padding: spacing.md,
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
      borderRadius: radius.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emergencyText: {
      flex: 1,
      gap: 4,
    },
    inlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    inlinePill: {
      marginTop: 2,
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
      gap: 2,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: glass.border,
      borderTopColor: glass.borderBright,
      backgroundColor: glass.fill,
      padding: spacing.md,
    },
    statIcon: {
      width: 28,
      height: 28,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: 2,
    },
    statValue: {
      color: colors.text,
      fontSize: 21,
      fontWeight: '700',
      letterSpacing: -0.5,
    },
    statLabel: {
      color: colors.textMuted,
      fontSize: 11,
    },
    segmented: {
      flexDirection: 'row',
      marginTop: spacing.md,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    segment: {
      flex: 1,
      minHeight: layout.touchTarget,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      paddingHorizontal: 4,
    },
    segmentActive: {
      backgroundColor: colors.accentSoft,
    },
    segmentText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    segmentTextActive: {
      color: colors.accent,
    },
    segmentCount: {
      minWidth: 18,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
    },
    segmentCountActive: {
      backgroundColor: `${colors.accent}33`,
    },
    segmentCountText: {
      color: colors.textFaint,
      fontSize: 10,
      fontWeight: '700',
    },
    segmentCountTextActive: {
      color: colors.accent,
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
    divider: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm + 2,
      paddingVertical: spacing.sm + 2,
    },
    itemIcon: {
      width: 38,
      height: 38,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    itemBody: {
      flex: 1,
      gap: 4,
    },
    itemTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    itemTitle: {
      flexShrink: 1,
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    itemMeta: {
      color: colors.textFaint,
      fontSize: 11,
      lineHeight: 16,
    },
    dangerText: {
      color: colors.danger,
    },
    restoreButton: {
      alignSelf: 'flex-start',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginTop: spacing.xs,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
    },
    restoreText: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '700',
    },
    revokeButton: {
      width: 34,
      height: 34,
      borderRadius: radius.sm,
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: `${colors.danger}47`,
      alignItems: 'center',
      justifyContent: 'center',
    },
    smallAction: {
      minWidth: 66,
      height: 32,
      borderRadius: radius.sm,
      backgroundColor: colors.dangerSoft,
      borderWidth: 1,
      borderColor: `${colors.danger}47`,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
    },
    smallActionText: {
      color: colors.danger,
      fontSize: 11,
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
      fontSize: 11,
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
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    auditBody: {
      flex: 1,
      gap: 3,
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
