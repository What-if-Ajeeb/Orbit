import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { useSession } from '@/context/auth';
import {
  approveAction,
  cancelAction,
  editAction,
  executeAction,
  getAgentAction,
  rejectAction,
  requestActionApproval,
} from '@/lib/agent-actions/service';
import type { AgentActionRecord, AgentActionStatus } from '@/lib/agent-actions/types';
import { radius, spacing } from '@/theme';

type Props = {
  actionId: string;
};

type Tone = 'neutral' | 'accent' | 'warning' | 'success' | 'danger';

const STATUS_META: Record<
  AgentActionStatus,
  { label: string; icon: keyof typeof Ionicons.glyphMap; tone: Tone }
> = {
  draft: { label: 'Draft — nothing sent', icon: 'document-outline', tone: 'neutral' },
  awaiting_approval: {
    label: 'Awaiting your approval',
    icon: 'shield-outline',
    tone: 'warning',
  },
  approved: { label: 'Approved — not executed', icon: 'checkmark-circle-outline', tone: 'accent' },
  executing: { label: 'Executing', icon: 'time-outline', tone: 'accent' },
  completed: { label: 'Completed', icon: 'checkmark-circle', tone: 'success' },
  rejected: { label: 'Rejected — nothing sent', icon: 'close-circle-outline', tone: 'danger' },
  cancelled: { label: 'Cancelled — nothing sent', icon: 'ban-outline', tone: 'neutral' },
  failed: { label: 'Failed', icon: 'alert-circle-outline', tone: 'danger' },
};

function toneColor(colors: AppTheme['colors'], tone: Tone): string {
  switch (tone) {
    case 'success':
      return colors.success;
    case 'warning':
      return colors.warning;
    case 'danger':
      return colors.danger;
    case 'accent':
      return colors.accent;
    default:
      return colors.textMuted;
  }
}

function toneBackground(colors: AppTheme['colors'], tone: Tone): string {
  switch (tone) {
    case 'success':
      return colors.successSoft;
    case 'warning':
      return colors.warningSoft;
    case 'danger':
      return colors.dangerSoft;
    case 'accent':
      return colors.accentSoft;
    default:
      return colors.surfaceAlt;
  }
}

export function AgentActionCard({ actionId }: Props) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const { user } = useSession();
  const [action, setAction] = useState<AgentActionRecord | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorText, setEditorText] = useState('{}');
  const [expanded, setExpanded] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      const found = await getAgentAction(db, actionId);
      setAction(found && found.userId === user.id ? found : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load this action.');
    }
  }, [actionId, db, user]);

  useEffect(() => {
    let active = true;

    void (async () => {
      if (!user) {
        return;
      }

      try {
        const found = await getAgentAction(db, actionId);

        if (active) {
          setAction(found && found.userId === user.id ? found : null);
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Could not load this action.');
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [actionId, db, user]);

  async function run(label: string, task: () => Promise<unknown>): Promise<void> {
    setBusy(label);
    setError(null);

    try {
      await task();
      await refresh();
    } catch (taskError) {
      setError(taskError instanceof Error ? taskError.message : 'The action could not be completed.');
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  function openEditor() {
    if (!action) {
      return;
    }

    const { __display: _display, ...payload } = action.payload;
    setEditorText(JSON.stringify(payload, null, 2));
    setEditorVisible(true);
  }

  async function saveEdit() {
    if (!user) {
      return;
    }

    let payload: Record<string, unknown>;

    try {
      const parsed = JSON.parse(editorText) as unknown;

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('The payload must be a JSON object.');
      }
      payload = parsed as Record<string, unknown>;
    } catch (parseError) {
      setError(parseError instanceof Error ? parseError.message : 'Invalid JSON payload.');
      return;
    }

    setEditorVisible(false);
    await run('editing', async () => {
      await editAction(db, actionId, user.id, payload);
    });
  }

  if (!action) {
    return null;
  }

  if (!user) {
    return null;
  }

  const meta = STATUS_META[action.status];
  const iconColor = toneColor(colors, meta.tone);
  const canEdit = action.status !== 'executing' && action.status !== 'completed';
  const canRequestApproval = action.status === 'draft' || action.status === 'failed';
  const payloadText = JSON.stringify(action.payload, null, 2);

  return (
    <View style={styles.card} accessibilityRole="group" accessibilityLabel={`Agent action: ${action.title}`}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: toneBackground(colors, meta.tone) }]}>
          <Ionicons name={meta.icon} size={17} color={iconColor} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title} numberOfLines={2}>
            {action.title}
          </Text>
          <Text style={[styles.status, { color: iconColor }]}>{meta.label}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={expanded ? 'Collapse action details' : 'Expand action details'}
          hitSlop={8}
          onPress={() => setExpanded((current) => !current)}
          style={styles.expandButton}
        >
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={colors.textFaint}
          />
        </Pressable>
      </View>

      <View style={styles.targetRow}>
        <Ionicons name="locate-outline" size={14} color={colors.textMuted} />
        <Text style={styles.target} numberOfLines={2}>
          {action.target || 'No external target'}
        </Text>
      </View>

      {action.lines.map((line, index) => (
        <Text key={`${line}-${index}`} style={styles.detailLine} numberOfLines={2}>
          {line}
        </Text>
      ))}

      {expanded ? (
        <View style={styles.expanded}>
          <Text style={styles.sectionLabel}>Exact target</Text>
          <ScrollView style={styles.payloadBox} nestedScrollEnabled>
            <Text selectable style={styles.payloadText}>
              {action.target || '(none)'}
            </Text>
          </ScrollView>
          <Text style={styles.sectionLabel}>Exact payload</Text>
          <ScrollView style={styles.payloadBox} nestedScrollEnabled>
            <Text selectable style={styles.payloadText}>
              {payloadText}
            </Text>
          </ScrollView>
          <Text style={styles.metaText}>
            {action.kind} · {action.toolName} · risk {action.risk} · {action.category}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.push({
                pathname: '/agent-action',
                params: { id: action.id },
              })
            }
            style={styles.linkButton}
          >
            <Text style={styles.linkText}>Open full action details</Text>
          </Pressable>
        </View>
      ) : null}

      {action.error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={14} color={colors.danger} />
          <Text style={styles.errorText}>{action.error}</Text>
        </View>
      ) : null}

      {action.result ? (
        <View style={styles.resultBox}>
          <Ionicons name="terminal-outline" size={14} color={colors.success} />
          <Text style={styles.resultText} numberOfLines={expanded ? undefined : 3}>
            {action.result}
          </Text>
        </View>
      ) : null}

      {error ? (
        <View style={styles.errorBox}>
          <Ionicons name="warning-outline" size={14} color={colors.danger} />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        {canRequestApproval ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Request approval for this exact action"
            disabled={busy !== null}
            onPress={() => void run('requesting', () => requestActionApproval(db, actionId, user.id))}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
          >
            {busy === 'requesting' ? (
              <ActivityIndicator color={colors.onInverse} size="small" />
            ) : (
              <Text style={styles.primaryText}>Review & request approval</Text>
            )}
          </Pressable>
        ) : null}

        {action.status === 'awaiting_approval' ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Approve this exact action"
              disabled={busy !== null}
              onPress={() => void run('approving', () => approveAction(db, actionId, user.id))}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            >
              {busy === 'approving' ? (
                <ActivityIndicator color={colors.onInverse} size="small" />
              ) : (
                <Text style={styles.primaryText}>Approve exact payload</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Reject this action"
              disabled={busy !== null}
              onPress={() => void run('rejecting', () => rejectAction(db, actionId, user.id))}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>Reject</Text>
            </Pressable>
          </>
        ) : null}

        {action.status === 'approved' ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Execute the approved action"
              disabled={busy !== null}
              onPress={() => void run('executing', () => executeAction(db, actionId, user.id))}
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            >
              {busy === 'executing' ? (
                <ActivityIndicator color={colors.onInverse} size="small" />
              ) : (
                <Text style={styles.primaryText}>Execute confirmed action</Text>
              )}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel the approved action"
              disabled={busy !== null}
              onPress={() => void run('cancelling', () => cancelAction(db, actionId, user.id))}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </Pressable>
          </>
        ) : null}

        {action.status === 'executing' ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Request cancellation"
            disabled={busy !== null}
            onPress={() => void run('stopping', () => cancelAction(db, actionId, user.id))}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>Request stop</Text>
          </Pressable>
        ) : null}

        {canEdit ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit payload"
            disabled={busy !== null}
            onPress={openEditor}
            style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
          >
            <Text style={styles.secondaryText}>Edit payload</Text>
          </Pressable>
        ) : null}
      </View>

      <Modal visible={editorVisible} animationType="slide" transparent onRequestClose={() => setEditorVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text accessibilityRole="header" style={styles.modalTitle}>
              Edit exact payload
            </Text>
            <Text style={styles.modalCopy}>
              Changing any value invalidates approval. You must review and confirm the new payload again.
            </Text>
            <TextInput
              accessibilityLabel="Action payload JSON"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              style={styles.editor}
              value={editorText}
              onChangeText={setEditorText}
            />
            <View style={styles.modalActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setEditorVisible(false)}
                style={styles.secondaryButton}
              >
                <Text style={styles.secondaryText}>Close</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                onPress={() => void saveEdit()}
                style={styles.primaryButton}
              >
                <Text style={styles.primaryText}>Save & invalidate approval</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    card: {
      alignSelf: 'stretch',
      gap: spacing.xs,
      marginTop: spacing.xs,
      maxWidth: 420,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surface,
      padding: spacing.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    icon: {
      width: 32,
      height: 32,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerCopy: {
      flex: 1,
      gap: 2,
    },
    title: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    status: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.3,
    },
    expandButton: {
      padding: 4,
    },
    targetRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
    },
    target: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 12,
    },
    detailLine: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 15,
    },
    expanded: {
      gap: 4,
      paddingTop: spacing.xs,
    },
    sectionLabel: {
      color: colors.textFaint,
      fontSize: 10,
      fontWeight: '800',
      letterSpacing: 1,
      textTransform: 'uppercase',
    },
    payloadBox: {
      maxHeight: 140,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceAlt,
      padding: spacing.sm,
    },
    payloadText: {
      color: colors.text,
      fontFamily: 'monospace',
      fontSize: 11,
      lineHeight: 15,
    },
    metaText: {
      color: colors.textFaint,
      fontSize: 10,
    },
    linkButton: {
      alignSelf: 'flex-start',
      paddingVertical: 4,
    },
    linkText: {
      color: colors.blue,
      fontSize: 11,
      fontWeight: '600',
    },
    errorBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      borderRadius: radius.sm,
      backgroundColor: colors.dangerSoft,
      padding: spacing.sm,
    },
    errorText: {
      flex: 1,
      color: colors.danger,
      fontSize: 11,
      lineHeight: 15,
    },
    resultBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      borderRadius: radius.sm,
      backgroundColor: colors.successSoft,
      padding: spacing.sm,
    },
    resultText: {
      flex: 1,
      color: colors.text,
      fontSize: 11,
      lineHeight: 15,
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
      paddingTop: 2,
    },
    primaryButton: {
      minHeight: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      backgroundColor: colors.inverse,
      paddingHorizontal: spacing.md,
    },
    primaryText: {
      color: colors.onInverse,
      fontSize: 12,
      fontWeight: '700',
    },
    secondaryButton: {
      minHeight: 34,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: spacing.md,
    },
    secondaryText: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
    },
    pressed: {
      opacity: 0.72,
    },
    modalBackdrop: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.55)',
      padding: spacing.md,
    },
    modalCard: {
      width: '100%',
      maxWidth: 520,
      gap: spacing.sm,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      padding: spacing.md,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    modalCopy: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    editor: {
      minHeight: 180,
      maxHeight: 320,
      width: '100%',
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      fontFamily: 'monospace',
      fontSize: 12,
      padding: spacing.sm,
      textAlignVertical: 'top',
    },
    modalActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: spacing.xs,
    },
  });
