import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FormError } from '@/components/FormError';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SettingsNavRow } from '@/components/SettingsNavRow';
import { SettingsSection } from '@/components/SettingsSection';
import { SidebarButton } from '@/components/SidebarButton';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
import { usePluginActions } from '@/components/plugins/usePluginActions';
import { useSession } from '@/context/auth';
import { usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { listAgentConfigs } from '@/lib/agent-settings';
import { connectionLabel, connectionScopes, listGoogleConnectionStates } from '@/lib/connections/google';
import { GOOGLE_CONNECTION_IDS, type GoogleConnectionId } from '@/lib/connections/types';
import { RISK_META, permissionManager } from '@/lib/permissions';
import type {
  PermissionDenialRecord,
  PermissionGrantRecord,
  PermissionPreferenceRecord,
} from '@/lib/permissions';
import { policyEngine, waitForPolicyHydration } from '@/lib/policy';
import { radius, spacing, typography } from '@/theme';

function preferenceKey(
  preference: Pick<
    PermissionPreferenceRecord,
    'agentId' | 'toolName' | 'scopeKey' | 'resourceKey'
  >
): string {
  return [
    preference.agentId,
    preference.toolName,
    preference.scopeKey,
    preference.resourceKey,
  ].join('|');
}

function riskTone(risk: PermissionGrantRecord['risk']): StatusTone {
  return RISK_META[risk].colorToken;
}

function grantStatusTone(status: PermissionGrantRecord['status']): StatusTone {
  if (status === 'active') {
    return 'success';
  }

  if (status === 'revoked') {
    return 'danger';
  }

  return 'neutral';
}

function decisionTone(decision: 'allow' | 'deny' | 'ask'): StatusTone {
  if (decision === 'allow') {
    return 'success';
  }

  if (decision === 'deny') {
    return 'danger';
  }

  return 'warning';
}

export default function ToolPermissionsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const db = useSQLiteContext();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const snapshot = usePluginSnapshot();
  const pluginActions = usePluginActions();
  const [grants, setGrants] = useState<PermissionGrantRecord[]>([]);
  const [denials, setDenials] = useState<PermissionDenialRecord[]>([]);
  const [preferences, setPreferences] = useState<PermissionPreferenceRecord[]>([]);
  const [connections, setConnections] = useState<GoogleConnectionId[]>([]);
  const [agents, setAgents] = useState<{ id: string; name: string; tools: number }[]>([]);
  const [rules, setRules] = useState(policyEngine.listRules());
  const [loading, setLoading] = useState(true);
  const [busyGrant, setBusyGrant] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      await waitForPolicyHydration();
      const [dashboard, states, configs] = await Promise.all([
        permissionManager.getDashboard(user.id),
        listGoogleConnectionStates(user.id, false),
        listAgentConfigs(db, user.id),
      ]);

      setGrants(
        [...dashboard.grants].sort(
          (a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)
        )
      );
      setDenials(dashboard.denials);
      setPreferences(dashboard.preferences);
      setConnections(
        states.filter((state) => state.status === 'connected').map((state) => state.id)
      );
      setAgents(
        configs.map((config) => ({
          id: config.agentId,
          name: config.agentId,
          tools: config.toolAccessMode === 'all' ? -1 : config.allowedTools.length,
        }))
      );
      setRules(policyEngine.listRules());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load permissions.');
    } finally {
      setLoading(false);
    }
  }, [db, user]);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  if (!user) {
    return null;
  }

  const activeUser = user;

  async function revokeGrant(grant: PermissionGrantRecord) {
    setBusyGrant(grant.id);
    setError(null);

    try {
      const removed = await permissionManager.revokeGrant(activeUser.id, grant.id);
      setNotice(removed ? `Revoked ${grant.toolName} for ${grant.agentName}.` : 'Grant was already removed.');
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke that grant.');
    } finally {
      setBusyGrant(null);
    }
  }

  async function revokeDenial(denial: PermissionDenialRecord) {
    setBusyGrant(denial.id);
    setError(null);

    try {
      const removed = await permissionManager.revokeDenial(activeUser.id, denial.id);
      setNotice(removed ? 'Never allow was revoked. The exact action can be requested again.' : 'This choice was already revoked.');
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke that choice.');
    } finally {
      setBusyGrant(null);
    }
  }

  async function revokePreference(preference: PermissionPreferenceRecord) {
    const key = preferenceKey(preference);
    setBusyGrant(key);
    setError(null);

    try {
      const removed = await permissionManager.revokePreference(activeUser.id, preference);
      setNotice(removed ? 'Ask every time was revoked.' : 'This choice was already revoked.');
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Could not revoke that choice.');
    } finally {
      setBusyGrant(null);
    }
  }

  const activeDenials = denials.filter((entry) => entry.revokedAt === null);
  const activePreferences = preferences.filter((entry) => entry.revokedAt === null);
  const installedPlugins = snapshot.summaries.filter(
    (summary) => summary.status !== 'discovered' && summary.status !== 'available'
  );

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
          eyebrow="LEAST PRIVILEGE"
          title="Tool permissions"
          subtitle="Review what agents may use, revoke saved grants, and check which accounts are authorized."
          left={<SidebarButton onPress={openSidebar} />}
        />

        <FormError message={error} onDismiss={() => setError(null)} />
        {notice ? (
          <View style={styles.success}>
            <Ionicons name="checkmark-circle-outline" size={17} color={colors.success} />
            <Text style={styles.successText}>{notice}</Text>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <>
            <SettingsSection
              title="Connected account access"
              description="Only accounts explicitly connected here can be used by agents. Each connection is scoped to this app."
            >
              <GlassView style={styles.card}>
                {GOOGLE_CONNECTION_IDS.map((id, index) => {
                  const active = connections.includes(id);

                  return (
                    <View key={id} style={index > 0 ? styles.divider : undefined}>
                      <View style={styles.row}>
                        <View style={styles.iconWrap}>
                          <Ionicons
                            name="cloud-outline"
                            size={18}
                            color={active ? colors.success : colors.textFaint}
                          />
                        </View>
                        <View style={styles.rowCopy}>
                          <Text style={styles.rowTitle}>{connectionLabel(id)}</Text>
                          <Text style={styles.rowText}>
                            {active ? 'Connected · scopes granted to this app' : 'Not connected'}
                          </Text>
                          <Text style={styles.scopes}>{connectionScopes(id).join('\n')}</Text>
                        </View>
                        <StatusPill
                          label={active ? 'Connected' : 'Not connected'}
                          tone={active ? 'success' : 'neutral'}
                          showDot={active}
                        />
                      </View>
                    </View>
                  );
                })}
              </GlassView>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/connections' as Href)}
                style={styles.link}
              >
                <Text style={styles.linkText}>Manage connections</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.accent} />
              </Pressable>
            </SettingsSection>

            <SettingsSection
              title="Agent tool allowlists"
              description="Each agent starts with a small safe tool list. Open an agent to review or change its allowlist."
            >
              {agents.length === 0 ? (
                <EmptyState
                  icon="options-outline"
                  title="No customization yet"
                  message="Agents start with a small safe tool list."
                />
              ) : (
                <GlassView style={styles.card}>
                  {agents.map((agent, index) => (
                    <View key={agent.id} style={index > 0 ? styles.divider : undefined}>
                      <SettingsNavRow
                        icon="hardware-chip-outline"
                        title={agent.name}
                        description={
                          agent.tools < 0
                            ? 'All registered tools allowed'
                            : `${agent.tools} allowed tool pattern${agent.tools === 1 ? '' : 's'}`
                        }
                        badge={agent.tools < 0 ? 'All tools' : `${agent.tools}`}
                        accessibilityLabel={`Open tools for ${agent.name}`}
                        onPress={() =>
                          router.push(`/agents/${encodeURIComponent(agent.id)}/tools` as Href)
                        }
                      />
                    </View>
                  ))}
                </GlassView>
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/agents' as Href)}
                style={styles.link}
              >
                <Text style={styles.linkText}>Open agent list</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.accent} />
              </Pressable>
            </SettingsSection>

            <SettingsSection
              title="Saved tool grants"
              description="One-time approvals expire automatically. Sensitive actions always ask again."
            >
              <FormError message={pluginActions.error} onDismiss={pluginActions.clear} />
              {grants.length === 0 ? (
                <EmptyState
                  icon="shield-outline"
                  title="No saved grants"
                  message="One-time approvals expire automatically. Sensitive actions always ask again."
                />
              ) : (
                <GlassView style={styles.card}>
                  {grants.map((grant, index) => (
                    <View key={grant.id} style={index > 0 ? styles.divider : undefined}>
                      <View style={styles.row}>
                        <View style={styles.rowCopy}>
                          <Text style={styles.rowTitle}>{grant.toolName}</Text>
                          <Text style={styles.rowText}>
                            {grant.agentName} · {grant.scopeKey}
                          </Text>
                          <Text style={styles.rowText}>Resource: {grant.resourceKey}</Text>
                          <Text style={styles.cardMeta}>
                            {RISK_META[grant.risk].shortLabel} risk · used {grant.useCount} time
                            {grant.useCount === 1 ? '' : 's'}
                          </Text>
                        </View>
                        <View style={styles.actionColumn}>
                          <StatusPill
                            label={grant.status.charAt(0).toUpperCase() + grant.status.slice(1)}
                            tone={grantStatusTone(grant.status)}
                            showDot
                          />
                          <StatusPill label={RISK_META[grant.risk].label} tone={riskTone(grant.risk)} />
                          <Button
                            label="Revoke"
                            variant="danger"
                            onPress={() => void revokeGrant(grant)}
                            disabled={busyGrant === grant.id}
                            loading={busyGrant === grant.id}
                          />
                        </View>
                      </View>
                    </View>
                  ))}
                </GlassView>
              )}
            </SettingsSection>

            <SettingsSection
              title="Saved choices"
              description="Never allow and Ask every time apply to one exact agent, tool, action, and resource. Revoking a choice does not execute anything."
            >
              {activeDenials.length === 0 && activePreferences.length === 0 ? (
                <EmptyState
                  icon="options-outline"
                  title="No saved choices"
                  message="Every protected action will be asked about until you choose one."
                />
              ) : (
                <GlassView style={styles.card}>
                  {activeDenials.map((denial, index) => (
                    <View key={denial.id} style={index > 0 ? styles.divider : undefined}>
                      <View style={styles.row}>
                        <View style={styles.rowCopy}>
                          <Text style={styles.rowTitle}>Never allow</Text>
                          <Text style={styles.rowText}>
                            Agent: {denial.agentId} · Tool: {denial.toolName}
                          </Text>
                          <Text style={styles.cardMeta}>Scope: {denial.scopeKey}</Text>
                          <Text style={styles.cardMeta}>Resource: {denial.resourceKey}</Text>
                        </View>
                        <View style={styles.actionColumn}>
                          <StatusPill label="Saved choice" tone="danger" icon="ban-outline" />
                          <Button
                            label="Revoke"
                            variant="danger"
                            onPress={() => void revokeDenial(denial)}
                            disabled={busyGrant === denial.id}
                            loading={busyGrant === denial.id}
                          />
                        </View>
                      </View>
                    </View>
                  ))}
                  {activePreferences.map((preference, index) => (
                    <View
                      key={preferenceKey(preference)}
                      style={index > 0 || activeDenials.length > 0 ? styles.divider : undefined}
                    >
                      <View style={styles.row}>
                        <View style={styles.rowCopy}>
                          <Text style={styles.rowTitle}>Ask every time</Text>
                          <Text style={styles.rowText}>
                            Agent: {preference.agentId} · Tool: {preference.toolName}
                          </Text>
                          <Text style={styles.cardMeta}>Scope: {preference.scopeKey}</Text>
                          <Text style={styles.cardMeta}>Resource: {preference.resourceKey}</Text>
                        </View>
                        <View style={styles.actionColumn}>
                          <StatusPill
                            label="Saved choice"
                            tone="warning"
                            icon="help-circle-outline"
                          />
                          <Button
                            label="Revoke"
                            variant="danger"
                            onPress={() => void revokePreference(preference)}
                            disabled={busyGrant === preferenceKey(preference)}
                            loading={busyGrant === preferenceKey(preference)}
                          />
                        </View>
                      </View>
                    </View>
                  ))}
                </GlassView>
              )}
            </SettingsSection>

            <SettingsSection
              title="Plugin permissions"
              description="Installed plugins only receive the permissions you approved. Open a plugin to review them."
            >
              {installedPlugins.length === 0 ? (
                <EmptyState
                  icon="extension-puzzle-outline"
                  title="No installed plugins"
                  message="Plugins you install will appear here with their granted permissions."
                />
              ) : (
                <GlassView style={styles.card}>
                  {installedPlugins.map((summary, index) => {
                    const missing = summary.missingPermissions.length;

                    return (
                      <View
                        key={summary.manifest.pluginId}
                        style={index > 0 ? styles.divider : undefined}
                      >
                        <View style={styles.row}>
                          <View style={styles.iconWrap}>
                            <Ionicons
                              name="extension-puzzle-outline"
                              size={18}
                              color={colors.accent}
                            />
                          </View>
                          <View style={styles.rowCopy}>
                            <Text style={styles.rowTitle}>{summary.manifest.name}</Text>
                            <Text style={styles.rowText}>
                              {summary.grantedPermissions.length} granted · {missing} missing
                            </Text>
                          </View>
                          <StatusPill
                            label={missing === 0 ? 'Ready' : `${missing} missing`}
                            tone={missing === 0 ? 'success' : 'warning'}
                            showDot
                          />
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel={`Open ${summary.manifest.name}`}
                            onPress={() =>
                              router.push(
                                `/plugins/${encodeURIComponent(summary.manifest.pluginId)}` as Href
                              )
                            }
                            style={styles.iconLink}
                          >
                            <Ionicons name="settings-outline" size={19} color={colors.accent} />
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                </GlassView>
              )}
            </SettingsSection>

            <SettingsSection
              title="Tool policy rules"
              description="Allow means the call can proceed. Ask always opens the approval dialog. Deny blocks the call before execution."
            >
              <GlassView style={styles.card}>
                {rules.map((rule, index) => (
                  <View key={rule.id} style={index > 0 ? styles.divider : undefined}>
                    <View style={styles.row}>
                      <View style={styles.rowCopy}>
                        <Text style={styles.rowTitle}>{rule.name}</Text>
                        <Text style={styles.cardMeta}>{rule.pattern}</Text>
                      </View>
                      <View style={styles.actionColumn}>
                        <StatusPill
                          label={rule.decision.charAt(0).toUpperCase() + rule.decision.slice(1)}
                          tone={decisionTone(rule.decision)}
                          icon={
                            rule.decision === 'allow'
                              ? 'checkmark-circle-outline'
                              : rule.decision === 'deny'
                                ? 'ban-outline'
                                : 'help-circle-outline'
                          }
                        />
                        <Switch
                          accessibilityLabel={`Enable ${rule.name}`}
                          value={rule.enabled}
                          onValueChange={(next) => {
                            policyEngine.setRuleEnabled(rule.id, next);
                            setRules(policyEngine.listRules());
                          }}
                          trackColor={{ false: colors.surfaceAlt, true: colors.accentSoft }}
                          thumbColor={rule.enabled ? colors.accent : colors.textFaint}
                        />
                      </View>
                    </View>
                  </View>
                ))}
              </GlassView>
            </SettingsSection>
          </>
        )}
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
      gap: spacing.lg,
    },
    loading: {
      paddingVertical: spacing.xl,
      alignItems: 'center',
    },
    success: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.successSoft,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    successText: {
      flex: 1,
      color: colors.success,
      ...typography.bodySmall,
    },
    card: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.lg,
      backgroundColor: colors.surface,
      overflow: 'hidden',
    },
    divider: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      padding: spacing.md,
    },
    iconWrap: {
      width: 38,
      height: 38,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowCopy: {
      flex: 1,
      gap: 3,
    },
    rowTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    rowText: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    scopes: {
      color: colors.textFaint,
      fontSize: 11,
      lineHeight: 15,
    },
    cardMeta: {
      color: colors.textFaint,
      fontSize: 11,
      lineHeight: 16,
    },
    actionColumn: {
      alignItems: 'flex-end',
      gap: spacing.xs,
      maxWidth: 128,
    },
    link: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: spacing.xs,
      paddingVertical: spacing.xs,
    },
    linkText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '700',
    },
    iconLink: {
      width: 40,
      height: 40,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
