import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  pluginApprovalService,
  type PluginApprovalRequest,
} from '@/lib/plugins/approvals';
import {
  PLUGIN_PERMISSION_META,
  isSensitivePermission,
} from '@/lib/plugins/permissions';
import type { PluginTrustLevel } from '@/lib/plugins/types';
import { radius, spacing } from '@/theme';

const TRUST_LABEL: Record<PluginTrustLevel, string> = {
  official: 'Official ORBIT plugin',
  verified: 'Verified publisher',
  community: 'Community plugin',
  local: 'Installed locally',
  untrusted: 'Untrusted plugin',
};

/**
 * Global approval surface for plugin permissions and sensitive plugin tools.
 * The platform blocks on this modal and defaults to deny after two minutes or
 * when the host unmounts.
 */
export function PluginApprovalHost() {
  const [request, setRequest] = useState<PluginApprovalRequest | null>(() =>
    pluginApprovalService.getPending()
  );
  const [busy, setBusy] = useState<'allow' | 'deny' | null>(null);

  useEffect(() => {
    const update = () => {
      setRequest(pluginApprovalService.getPending());
      setBusy(null);
    };

    update();
    return pluginApprovalService.subscribe(update);
  }, []);

  if (!request) {
    return null;
  }

  return (
    <PluginApprovalDialog
      key={request.id}
      request={request}
      busy={busy}
      onAllow={() => {
        setBusy('allow');
        pluginApprovalService.approve(request.id);
      }}
      onDeny={() => {
        setBusy('deny');
        pluginApprovalService.deny(request.id);
      }}
    />
  );
}

function PluginApprovalDialog({
  request,
  busy,
  onAllow,
  onDeny,
}: {
  request: PluginApprovalRequest;
  busy: 'allow' | 'deny' | null;
  onAllow: () => void;
  onDeny: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const disabled = busy !== null;
  const install = request.kind === 'install' ? request : null;

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={disabled ? undefined : onDeny}
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Deny plugin request"
          onPress={disabled ? undefined : onDeny}
          style={StyleSheet.absoluteFill}
        />
        <View
          style={[
            styles.card,
            {
              marginTop: insets.top + spacing.md,
              marginBottom: insets.bottom + spacing.md,
            },
          ]}
        >
          <View style={styles.header}>
            <View style={styles.iconBubble}>
              <Ionicons
                name={
                  install
                    ? 'extension-puzzle-outline'
                    : request.kind === 'tool'
                      ? 'flash-outline'
                      : 'shield-checkmark-outline'
                }
                size={21}
                color={colors.accent}
              />
            </View>
            <View style={styles.headerText}>
              <Text style={styles.eyebrow}>
                {install
                  ? 'PLUGIN INSTALL APPROVAL'
                  : request.kind === 'tool'
                    ? 'PLUGIN TOOL APPROVAL'
                    : 'PLUGIN PERMISSION REQUEST'}
              </Text>
              <Text style={styles.title}>{request.pluginName}</Text>
              <Text style={styles.subtitle}>
                {TRUST_LABEL[request.trustLevel]} · {request.pluginId}
              </Text>
            </View>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <Text style={styles.reason}>{request.reason}</Text>

            {install ? (
              <View style={styles.installBlock}>
                <Text style={styles.sectionLabel}>WHY THIS IS NEEDED</Text>
                <Text style={styles.detailText}>{install.capabilityLabel}</Text>
                <Text style={styles.detailText}>Version {install.pluginVersion}</Text>
                <Text style={styles.sectionLabel}>INSPECTED PACKAGE</Text>
                <Text style={styles.detailText}>
                  {install.inspection?.pluginId ?? install.pluginId} · {install.inspection?.registry ?? 'bundled-catalog'} · request #{request.id}
                </Text>
                <Text style={styles.detailText}>
                  Publisher: {install.inspection?.publisherName ?? 'Unknown'} (
                  {install.inspection?.publisherVerified ? 'verified' : 'not verified'})
                </Text>
                <Text style={styles.detailText}>
                  Compatibility: {install.inspection?.compatible === false ? 'FAILED' : 'checked'}
                  {install.inspection?.minimumOrbitVersion
                    ? ` · ORBIT ${install.inspection.minimumOrbitVersion}+`
                    : ''}
                </Text>
                {install.inspection?.warnings.map((warning, index) => (
                  <Text key={`${warning}-${index}`} style={styles.detailText}>
                    · {warning}
                  </Text>
                ))}
                <Text style={styles.sectionLabel}>WHAT WILL HAPPEN</Text>
                {install.steps.map((step, index) => (
                  <Text key={`${step}-${index}`} style={styles.detailText}>
                    · {step}
                  </Text>
                ))}
                {install.dependencies.length > 0 ? (
                  <>
                    <Text style={styles.sectionLabel}>REQUIRED DEPENDENCIES</Text>
                    {install.dependencies.map((dependency) => (
                      <Text key={dependency.pluginId} style={styles.detailText}>
                        · {dependency.name} {dependency.version} (
                        {dependency.installed ? 'installed' : 'will install'},{' '}
                        {dependency.running ? 'active' : 'will activate'})
                      </Text>
                    ))}
                  </>
                ) : null}
                {install.sensitivePermissions.length > 0 ? (
                  <Text style={styles.warningText}>
                    Sensitive access is listed below and is granted only if you approve.
                  </Text>
                ) : null}
                {install.requiresSandbox ? (
                  <Text style={styles.warningText}>
                    This plugin declares sandbox execution. Every run still needs a separate
                    sandbox approval.
                  </Text>
                ) : null}
              </View>
            ) : null}

            {request.permissions.length > 0 ? (
              <View style={styles.permissionList}>
                <Text style={styles.sectionLabel}>REQUESTED ACCESS</Text>
                {request.permissions.map((permission) => {
                  const meta = PLUGIN_PERMISSION_META[permission];

                  return (
                    <View key={permission} style={styles.permissionRow}>
                      <Ionicons
                        name={
                          isSensitivePermission(permission)
                            ? 'warning-outline'
                            : 'checkmark-circle-outline'
                        }
                        size={16}
                        color={
                          isSensitivePermission(permission)
                            ? colors.warning
                            : colors.accent
                        }
                      />
                      <View style={styles.permissionText}>
                        <Text style={styles.permissionLabel}>{meta.label}</Text>
                        <Text style={styles.permissionDetail}>{meta.description}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : null}

            <View style={styles.note}>
              <Ionicons name="shield-outline" size={15} color={colors.textMuted} />
              <Text style={styles.noteText}>
                {install
                  ? install.requiresUpdate
                    ? 'Approving updates only this reviewed plugin and grants only the listed permissions to it. Nothing is downloaded or installed for other plugins.'
                    : 'Approving installs only this reviewed plugin and grants only the listed permissions to it. Nothing is downloaded or installed for other plugins.'
                  : "Approving grants only the listed permissions to this plugin. It never grants agent tool permissions or access to other plugins' data."}
              </Text>
            </View>
          </ScrollView>

          <View style={styles.actions}>
            <Button
              label={
                install
                  ? install.requiresUpdate
                    ? 'Update & grant'
                    : 'Install & grant'
                  : request.kind === 'tool'
                    ? 'Run once'
                    : 'Allow'
              }
              onPress={onAllow}
              loading={busy === 'allow'}
              disabled={disabled}
            />
            <Button
              label="Deny"
              variant="secondary"
              onPress={onDeny}
              loading={busy === 'deny'}
              disabled={disabled}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
      backgroundColor: 'rgba(3, 6, 12, 0.58)',
    },
    card: {
      width: '100%',
      maxWidth: 460,
      maxHeight: '86%',
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: glass.border,
      borderTopColor: glass.borderBright,
      backgroundColor: glass.fillStrong,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: glass.border,
    },
    iconBubble: {
      width: 44,
      height: 44,
      borderRadius: 15,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: {
      flex: 1,
      gap: 1,
    },
    eyebrow: {
      color: colors.accent,
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 1.4,
    },
    title: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: 11,
    },
    content: {
      padding: spacing.md,
      gap: spacing.md,
    },
    reason: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 19,
    },
    installBlock: {
      gap: spacing.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.fillSoft,
      padding: spacing.sm,
    },
    detailText: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
    },
    warningText: {
      color: colors.warning,
      fontSize: 11,
      lineHeight: 16,
    },
    permissionList: {
      gap: spacing.sm,
    },
    sectionLabel: {
      color: colors.textFaint,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 1.4,
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
      lineHeight: 16,
    },
    note: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    noteText: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
      padding: spacing.md,
      borderTopWidth: 1,
      borderTopColor: glass.border,
    },
  });
