import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { formatRelative } from '@/lib/dates';
import type { ActivityRecord, ActivityStatus } from '@/lib/safety/types';
import { radius, spacing } from '@/theme';

type Tone = 'accent' | 'success' | 'warning' | 'danger' | 'muted';

const STATUS_META: Record<ActivityStatus, { label: string; icon: string; tone: Tone }> = {
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

function iconOrFallback(name: string): keyof typeof Ionicons.glyphMap {
  return name in Ionicons.glyphMap ? (name as keyof typeof Ionicons.glyphMap) : 'shield-outline';
}

function toneColor(tone: Tone, colors: AppTheme['colors']): string {
  if (tone === 'success') return colors.success;
  if (tone === 'warning') return colors.warning;
  if (tone === 'danger') return colors.danger;
  if (tone === 'accent') return colors.accent;
  return colors.textFaint;
}

type AgentActivityTimelineProps = {
  records: ActivityRecord[];
  onOpenPermissions: () => void;
};

/** Compact, in-chat view of the same append-only activity journal used by the dashboard. */
export function AgentActivityTimeline({ records, onOpenPermissions }: AgentActivityTimelineProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const visible = records.slice(0, 6);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.heading}>AGENT ACTIVITY</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open agent permissions"
          hitSlop={8}
          onPress={onOpenPermissions}
          style={({ pressed }) => [styles.manageButton, pressed && styles.pressed]}
        >
          <Text style={styles.manageText}>Manage</Text>
          <Ionicons name="chevron-forward" size={13} color={colors.accent} />
        </Pressable>
      </View>

      {visible.length === 0 ? (
        <Text style={styles.empty}>No actions recorded for this chat yet.</Text>
      ) : (
        visible.map((record) => {
          const meta = STATUS_META[record.status];
          const color = toneColor(meta.tone, colors);
          const outcome = record.error || record.result;

          return (
            <View key={record.id} style={styles.row}>
              <View style={[styles.icon, { backgroundColor: `${color}22` }]}>
                <Ionicons name={iconOrFallback(meta.icon)} size={14} color={color} />
              </View>
              <View style={styles.body}>
                <Text style={styles.action} numberOfLines={2}>
                  {record.action}
                </Text>
                <Text style={styles.meta} numberOfLines={1}>
                  {formatRelative(record.createdAt)} · {record.agentName} · {meta.label}
                </Text>
                {record.resourceLabel ? (
                  <Text style={styles.meta} numberOfLines={1}>
                    Target: {record.resourceLabel}
                  </Text>
                ) : null}
                {record.permissionUsed ? (
                  <Text style={styles.meta} numberOfLines={1}>
                    Permission: {record.permissionUsed}
                  </Text>
                ) : null}
                {outcome ? (
                  <Text style={[styles.outcome, record.error ? styles.errorOutcome : null]} numberOfLines={2}>
                    {outcome}
                  </Text>
                ) : null}
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
    card: {
      marginHorizontal: spacing.lg,
      marginBottom: spacing.md,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: glass.border,
      backgroundColor: glass.fill,
      padding: spacing.md,
      gap: spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    heading: {
      color: colors.textFaint,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1.5,
    },
    manageButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
    },
    manageText: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '600',
    },
    empty: {
      color: colors.textFaint,
      fontSize: 12,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    icon: {
      width: 26,
      height: 26,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    body: {
      flex: 1,
      gap: 2,
    },
    action: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
      lineHeight: 16,
    },
    meta: {
      color: colors.textFaint,
      fontSize: 10,
      lineHeight: 14,
    },
    outcome: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
    },
    errorOutcome: {
      color: colors.danger,
    },
    pressed: {
      opacity: 0.7,
    },
  });
