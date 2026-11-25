import Ionicons from '@expo/vector-icons/Ionicons';
import { router, type Href } from 'expo-router';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FormError } from '@/components/FormError';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  permissionManager,
  type PermissionDecisionOption,
  type PermissionRequestRecord,
} from '@/lib/permissions';
import { pluginApprovalService, type PluginApprovalRequest } from '@/lib/plugins/approvals';
import { PLUGIN_PERMISSION_META } from '@/lib/plugins/permissions';
import { radius, spacing } from '@/theme';

const subscribePermissions = (listener: () => void) => permissionManager.subscribe(listener);
const getPermissionSnapshot = () => permissionManager.getState();
const subscribePlugins = (listener: () => void) => pluginApprovalService.subscribe(listener);
const getPluginApproval = () => pluginApprovalService.getPending();
const getPluginQueued = () => pluginApprovalService.getQueuedCount();

function timeLeft(expiresAt: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));

  return seconds > 0 ? `${seconds}s left` : 'Expired';
}

function canSaveChoice(request: PermissionRequestRecord): boolean {
  return (
    request.allowAlways &&
    request.risk !== 'high' &&
    request.risk !== 'critical' &&
    !request.freshConfirmation &&
    request.metadata.policyDecision !== 'ask'
  );
}

function consequencesFor(request: PermissionRequestRecord): string[] {
  const value = request.metadata.consequences;
  return typeof value === 'string' ? value.split(' | ').filter(Boolean) : [];
}

export default function ApprovalsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const state = useSyncExternalStore(
    subscribePermissions,
    getPermissionSnapshot,
    getPermissionSnapshot
  );
  const pluginRequest = useSyncExternalStore(
    subscribePlugins,
    getPluginApproval,
    getPluginApproval
  );
  const pluginQueued = useSyncExternalStore(
    subscribePlugins,
    getPluginQueued,
    getPluginQueued
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [busyOption, setBusyOption] = useState<PermissionDecisionOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pluginInstall = pluginRequest?.kind === 'install' ? pluginRequest : null;

  const pending: PermissionRequestRecord[] = user
    ? state.queue.filter((request) => request.userId === user.id)
    : [];

  const resolve = useCallback(
    async (request: PermissionRequestRecord, option: PermissionDecisionOption) => {
      setBusyId(request.id);
      setBusyOption(option);
      setError(null);

      try {
        const result = await permissionManager.resolveRequest(request.id, option, request.userId);

        if (!result.ok) {
          setError(result.message ?? 'This request could not be resolved.');
        }
      } catch (resolveError) {
        setError(resolveError instanceof Error ? resolveError.message : 'Could not resolve request.');
      } finally {
        setBusyId(null);
        setBusyOption(null);
      }
    },
    []
  );

  const cancel = useCallback(async (request: PermissionRequestRecord) => {
    setBusyId(request.id);
    setBusyOption(null);
    setError(null);

    try {
      const result = await permissionManager.cancelRequest(request.id, request.userId);

      if (!result.ok) {
        setError(result.message ?? 'This request could not be cancelled.');
      }
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Could not cancel request.');
    } finally {
      setBusyId(null);
    }
  }, []);

  if (!user) {
    return null;
  }

  function pluginDecision(request: PluginApprovalRequest, approved: boolean) {
    setBusyId(String(request.id));
    setBusyOption(null);

    try {
      if (approved) {
        pluginApprovalService.approve(request.id);
      } else {
        pluginApprovalService.deny(request.id);
      }
    } finally {
      setBusyId(null);
    }
  }

  const hasAny = pending.length > 0 || Boolean(pluginRequest);

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
          eyebrow="Consent queue"
          title="Tool approvals"
          subtitle="Sensitive calls wait here. Denying or ignoring a request never grants access."
          left={<SidebarButton onPress={openSidebar} />}
        />

        <FormError message={error} onDismiss={() => setError(null)} />

        {!hasAny ? (
          <EmptyState
            icon="checkmark-done-outline"
            title="Nothing waiting"
            message="When an agent or plugin asks for a sensitive action, it appears here and in a dialog."
          />
        ) : (
          <View style={styles.list}>
            {pending.map((request) => (
              <GlassView key={request.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.iconWrap}>
                    <Ionicons name="shield-outline" size={21} color={colors.warning} />
                  </View>
                  <View style={styles.cardCopy}>
                    <Text style={styles.cardTitle}>{request.title}</Text>
                    <Text style={styles.meta}>
                      {request.agentName} · {request.toolName} · {request.risk} risk
                    </Text>
                  </View>
                  <Text style={styles.timer}>{timeLeft(request.expiresAt)}</Text>
                </View>

                <Text style={styles.summary}>{request.summary}</Text>
                {request.actions.length > 0 ? (
                  <View style={styles.actionsList}>
                    {request.actions.map((action, index) => (
                      <Text key={`${action}-${index}`} style={styles.actionItem}>
                        · {action}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {request.target.label ? (
                  <Text style={styles.meta}>Target: {request.target.label}</Text>
                ) : null}
                {request.target.detail ? (
                  <Text style={styles.meta}>Where: {request.target.detail}</Text>
                ) : null}
                {request.commandPreview ? (
                  <Text style={styles.meta}>Command: {request.commandPreview}</Text>
                ) : null}
                <Text style={styles.meta}>
                  Scope: {request.scopeKey} · Resource: {request.resourceKey}
                </Text>
                {consequencesFor(request).map((consequence, index) => (
                  <Text key={`${consequence}-${index}`} style={styles.warningText}>
                    Consequences: {consequence}
                  </Text>
                ))}
                <Text style={styles.meta}>
                  {request.reversible
                    ? 'Reversible from Agent activity.'
                    : request.external
                      ? 'External service: ORBIT cannot guarantee this can be undone.'
                      : 'ORBIT cannot undo this action.'}
                </Text>
                {request.freshConfirmation || request.risk === 'high' || request.risk === 'critical' ? (
                  <Text style={styles.dangerText}>
                    {request.risk === 'critical'
                      ? 'Critical action: payments, external sending, permanent deletion, and security changes always need fresh confirmation.'
                      : 'High-risk actions ask every time. A saved grant can never skip this prompt.'}
                  </Text>
                ) : null}

                <View style={styles.buttons}>
                  <Button
                    label="Allow once"
                    onPress={() => void resolve(request, 'allow_once')}
                    disabled={busyId === request.id}
                    loading={busyId === request.id && busyOption === 'allow_once'}
                  />
                  <Button
                    label="Allow for session"
                    variant="secondary"
                    onPress={() => void resolve(request, 'allow_session')}
                    disabled={busyId === request.id || !canSaveChoice(request)}
                    loading={busyId === request.id && busyOption === 'allow_session'}
                  />
                  <Button
                    label="Always allow"
                    variant="secondary"
                    onPress={() => void resolve(request, 'always_allow')}
                    disabled={busyId === request.id || !canSaveChoice(request)}
                    loading={busyId === request.id && busyOption === 'always_allow'}
                  />
                  <Button
                    label="Ask every time"
                    variant="secondary"
                    onPress={() => void resolve(request, 'ask_every_time')}
                    disabled={busyId === request.id}
                    loading={busyId === request.id && busyOption === 'ask_every_time'}
                  />
                  <Button
                    label="Never allow"
                    variant="danger"
                    onPress={() => void resolve(request, 'never_allow')}
                    disabled={busyId === request.id}
                    loading={busyId === request.id && busyOption === 'never_allow'}
                  />
                  <Button
                    label="Deny"
                    variant="danger"
                    onPress={() => void resolve(request, 'deny')}
                    disabled={busyId === request.id}
                    loading={busyId === request.id && busyOption === 'deny'}
                  />
                </View>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => void cancel(request)}
                  style={styles.cancelLink}
                >
                  <Text style={styles.cancelText}>Cancel request</Text>
                </Pressable>
              </GlassView>
            ))}

            {pluginRequest ? (
              <GlassView style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.iconWrap}>
                    <Ionicons name="extension-puzzle-outline" size={21} color={colors.warning} />
                  </View>
                  <View style={styles.cardCopy}>
                    <Text style={styles.cardTitle}>{pluginRequest.pluginName}</Text>
                    <Text style={styles.meta}>
                      {pluginInstall
                        ? `${pluginInstall.requiresUpdate ? 'Update' : 'Install'} approval · v${pluginInstall.pluginVersion}`
                        : pluginRequest.kind === 'tool'
                          ? pluginRequest.toolName
                          : 'Permission request'}
                    </Text>
                  </View>
                  <Text style={styles.timer}>{timeLeft(pluginRequest.expiresAt)}</Text>
                </View>
                <Text style={styles.summary}>{pluginRequest.reason}</Text>
                {pluginInstall ? (
                  <View style={styles.actionsList}>
                    <Text style={styles.meta}>
                      Needed for: {pluginInstall.capabilityLabel}
                    </Text>
                    {pluginInstall.steps.map((step, index) => (
                      <Text key={`${step}-${index}`} style={styles.actionItem}>
                        · {step}
                      </Text>
                    ))}
                    {pluginInstall.dependencies.length > 0 ? (
                      <Text style={styles.meta}>
                        Dependencies:{' '}
                        {pluginInstall.dependencies
                          .map((dependency) => `${dependency.name} ${dependency.version}`)
                          .join(', ')}
                      </Text>
                    ) : null}
                    {pluginInstall.sensitivePermissions.length > 0 ? (
                      <Text style={styles.warningText}>
                        Sensitive access is granted only if you approve.
                      </Text>
                    ) : null}
                  </View>
                ) : null}
                <View style={styles.permissionList}>
                  {pluginRequest.permissions.map((permission) => (
                    <Text key={permission} style={styles.actionItem}>
                      · {PLUGIN_PERMISSION_META[permission]?.label ?? permission}
                    </Text>
                  ))}
                </View>
                {pluginQueued > 0 ? (
                  <Text style={styles.meta}>{pluginQueued} more request(s) queued</Text>
                ) : null}
                <View style={styles.buttons}>
                  <Button
                    label={
                      pluginInstall
                        ? pluginInstall.requiresUpdate
                          ? 'Update & grant'
                          : 'Install & grant'
                        : 'Approve'
                    }
                    onPress={() => pluginDecision(pluginRequest, true)}
                    disabled={busyId === String(pluginRequest.id)}
                  />
                  <Button
                    label="Deny"
                    variant="danger"
                    onPress={() => pluginDecision(pluginRequest, false)}
                    disabled={busyId === String(pluginRequest.id)}
                  />
                </View>
              </GlassView>
            ) : null}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/tool-permissions' as Href)}
          style={styles.link}
        >
          <Text style={styles.linkText}>Review saved permissions</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.accent} />
        </Pressable>
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
    list: {
      gap: spacing.md,
    },
    card: {
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    iconWrap: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
      backgroundColor: colors.warningSoft ?? colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardCopy: {
      flex: 1,
      gap: 3,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    meta: {
      color: colors.textFaint,
      fontSize: 11,
      lineHeight: 16,
    },
    timer: {
      color: colors.warning,
      fontSize: 11,
      fontWeight: '700',
    },
    summary: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
    },
    actionsList: {
      gap: 2,
    },
    actionItem: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    warningText: {
      color: colors.warning,
      fontSize: 11,
      lineHeight: 16,
    },
    dangerText: {
      color: colors.danger,
      fontSize: 11,
      lineHeight: 16,
    },
    permissionList: {
      gap: 2,
    },
    buttons: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    cancelLink: {
      alignSelf: 'flex-start',
      paddingVertical: spacing.xs,
    },
    cancelText: {
      color: colors.textMuted,
      fontSize: 12,
      textDecorationLine: 'underline',
    },
    link: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: spacing.xs,
      paddingVertical: spacing.sm,
    },
    linkText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '700',
    },
  });
