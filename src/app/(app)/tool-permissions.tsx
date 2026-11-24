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
import { SidebarButton } from '@/components/SidebarButton';
import { usePluginActions } from '@/components/plugins/usePluginActions';
import { useSession } from '@/context/auth';
import { usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { listAgentConfigs } from '@/lib/agent-settings';
import { connectionLabel, connectionScopes, listGoogleConnectionStates } from '@/lib/connections/google';
import { GOOGLE_CONNECTION_IDS, type GoogleConnectionId } from '@/lib/connections/types';
import { permissionManager } from '@/lib/permissions';
import type { PermissionGrantRecord } from '@/lib/permissions';
import { policyEngine, waitForPolicyHydration } from '@/lib/policy';
import { radius, spacing } from '@/theme';

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
          eyebrow="Least privilege"
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
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Connected account access</Text>
              {GOOGLE_CONNECTION_IDS.map((id) => {
                const active = connections.includes(id);

                return (
                  <GlassView key={id} style={styles.row}>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>{connectionLabel(id)}</Text>
                      <Text style={styles.rowText}>
                        {active ? 'Connected · scopes granted to this app' : 'Not connected'}
                      </Text>
                      <Text style={styles.scopes}>{connectionScopes(id).join('\n')}</Text>
                    </View>
                    <Ionicons
                      name={active ? 'checkmark-circle-outline' : 'remove-circle-outline'}
                      size={20}
                      color={active ? colors.success : colors.textFaint}
                    />
                  </GlassView>
                );
              })}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/connections' as Href)}
                style={styles.link}
              >
                <Text style={styles.linkText}>Manage connections</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.accent} />
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Agent tool allowlists</Text>
              {agents.length === 0 ? (
                <Text style={styles.emptyText}>
                  No saved customization yet. Agents start with a small safe tool list.
                </Text>
              ) : (
                agents.map((agent) => (
                  <GlassView
                    key={agent.id}
                    onPress={() =>
                      router.push(`/agents/${encodeURIComponent(agent.id)}/tools` as Href)
                    }
                    style={styles.row}
                    accessibilityLabel={`Open tools for ${agent.name}`}
                  >
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>{agent.name}</Text>
                      <Text style={styles.rowText}>
                        {agent.tools < 0
                          ? 'All registered tools allowed'
                          : `${agent.tools} allowed tool pattern${agent.tools === 1 ? '' : 's'}`}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
                  </GlassView>
                ))
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/agents' as Href)}
                style={styles.link}
              >
                <Text style={styles.linkText}>Open agent list</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.accent} />
              </Pressable>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Saved tool grants</Text>
              <FormError message={pluginActions.error} onDismiss={pluginActions.clear} />
              {grants.length === 0 ? (
                <EmptyState
                  icon="shield-outline"
                  title="No saved grants"
                  message="One-time approvals expire automatically. Sensitive actions always ask again."
                />
              ) : (
                grants.map((grant) => (
                  <GlassView key={grant.id} style={styles.row}>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>{grant.toolName}</Text>
                      <Text style={styles.rowText}>
                        {grant.agentName} · {grant.scopeKey}
                      </Text>
                      <Text style={styles.cardMeta}>
                        {grant.risk} risk · used {grant.useCount} time{grant.useCount === 1 ? '' : 's'}
                      </Text>
                    </View>
                    <Button
                      label="Revoke"
                      variant="danger"
                      onPress={() => void revokeGrant(grant)}
                      disabled={busyGrant === grant.id}
                      loading={busyGrant === grant.id}
                    />
                  </GlassView>
                ))
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Plugin permissions</Text>
              {installedPlugins.length === 0 ? (
                <Text style={styles.emptyText}>No installed plugins.</Text>
              ) : (
                installedPlugins.map((summary) => (
                  <GlassView key={summary.manifest.pluginId} style={styles.row}>
                    <View style={styles.rowCopy}>
                      <Text style={styles.rowTitle}>{summary.manifest.name}</Text>
                      <Text style={styles.rowText}>
                        {summary.grantedPermissions.length} granted ·{' '}
                        {summary.missingPermissions.length} missing
                      </Text>
                    </View>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() =>
                        router.push(
                          `/plugins/${encodeURIComponent(summary.manifest.pluginId)}` as Href
                        )
                      }
                      style={styles.iconLink}
                    >
                      <Ionicons name="settings-outline" size={19} color={colors.accent} />
                    </Pressable>
                  </GlassView>
                ))
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Tool policy rules</Text>
              <Text style={styles.hint}>
                Allow means the call can proceed. Ask always opens the approval dialog. Deny blocks
                the call before execution.
              </Text>
              {rules.map((rule) => (
                <GlassView key={rule.id} style={styles.row}>
                  <View style={styles.rowCopy}>
                    <Text style={styles.rowTitle}>{rule.name}</Text>
                    <Text style={styles.rowText}>
                      {rule.pattern} · {rule.decision}
                    </Text>
                  </View>
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
                </GlassView>
              ))}
            </View>
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
      fontSize: 13,
    },
    section: {
      gap: spacing.sm,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 19,
      fontWeight: '700',
    },
    hint: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      padding: spacing.md,
    },
    rowCopy: {
      flex: 1,
      gap: 3,
    },
    rowTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    rowText: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    scopes: {
      color: colors.textFaint,
      fontSize: 10,
      lineHeight: 14,
    },
    cardMeta: {
      color: colors.textFaint,
      fontSize: 11,
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
      borderRadius: 20,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 13,
      lineHeight: 19,
    },
  });
