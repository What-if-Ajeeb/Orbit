import { usePluginPlatform } from '@/context/plugins';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FormError } from '@/components/FormError';
import { GlassView } from '@/components/GlassView';
import { SettingsSection } from '@/components/SettingsSection';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
import { TextField } from '@/components/TextField';
import {
  getMcpStatuses,
  getMcpToolCount,
  type McpServerSyncStatus,
} from '@/lib/mcp/registry';
import {
  buildMcpServer,
  loadMcpServers,
  saveMcpServers,
  type McpServerConfig,
} from '@/lib/mcp/settings';
import { layout, radius, spacing, typography } from '@/theme';

type McpServersCardProps = {
  onNotice: (message: string) => void;
  onError: (message: string | null) => void;
};

type Draft = {
  id: string | null;
  name: string;
  url: string;
  token: string;
  enabled: boolean;
};

type ServerStatusView = {
  label: string;
  tone: StatusTone;
  detail?: string;
  detailTone?: StatusTone;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  name: '',
  url: '',
  token: '',
  enabled: true,
};

function toolLabel(count: number): string {
  return `${count} tool${count === 1 ? '' : 's'}`;
}

function serverStatusView(
  server: McpServerConfig,
  status: McpServerSyncStatus | undefined,
  syncError: string | null
): ServerStatusView {
  if (!server.enabled) {
    return {
      label: 'Disabled',
      tone: 'neutral',
      detail: 'Its tools are not available to the agent.',
    };
  }

  if (syncError) {
    return {
      label: 'Not verified',
      tone: 'danger',
      detail: 'The last sync failed. Sync again to verify this server.',
      detailTone: 'danger',
    };
  }

  if (!status) {
    return {
      label: 'Not synced',
      tone: 'warning',
      detail: 'Sync tools to check this server.',
      detailTone: 'warning',
    };
  }

  if (!status.ok) {
    return {
      label: 'Failed',
      tone: 'danger',
      detail: status.error ?? 'Could not connect.',
      detailTone: 'danger',
    };
  }

  return {
    label: 'Connected',
    tone: 'success',
    detail:
      status.toolCount > 0
        ? `${toolLabel(status.toolCount)} available`
        : 'Connected with no tools found.',
  };
}

export function McpServersCard({ onNotice, onError }: McpServersCardProps) {
  const platform = usePluginPlatform();
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [statuses, setStatuses] = useState<McpServerSyncStatus[]>([]);
  const [toolCount, setToolCount] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void (async () => {
        const list = await loadMcpServers();

        if (platform.isReady()) {
          try {
            await platform.syncMcpServers(list, { refreshTools: false });
            if (active) {
              setSyncError(null);
            }
          } catch (error) {
            if (active) {
              const message =
                error instanceof Error
                  ? error.message
                  : 'Could not sync MCP plugin records.';

              setSyncError(message);
              onError(message);
            }
          }
        }

        if (active) {
          setServers(list);
          setStatuses(getMcpStatuses());
          setToolCount(getMcpToolCount());
        }
      })();

      return () => {
        active = false;
      };
    }, [platform, onError])
  );

  const statusById = useMemo(
    () => new Map(statuses.map((status) => [status.serverId, status])),
    [statuses]
  );

  const enabledCount = servers.filter((server) => server.enabled).length;
  const enabledIds = useMemo(
    () => new Set(servers.filter((server) => server.enabled).map((server) => server.id)),
    [servers]
  );
  const hasFailedServer = statuses.some(
    (status) => !status.ok && enabledIds.has(status.serverId)
  );

  const summary: ServerStatusView = isSyncing
    ? { label: 'Syncing…', tone: 'info' }
    : syncError
      ? { label: 'Sync failed', tone: 'danger', detail: syncError }
      : servers.length === 0
        ? { label: 'Not configured', tone: 'neutral' }
        : hasFailedServer
          ? { label: 'Connection failed', tone: 'danger' }
          : toolCount > 0
            ? { label: toolLabel(toolCount), tone: 'success' }
            : enabledCount > 0
              ? { label: 'No tools yet', tone: 'warning' }
              : { label: 'All disabled', tone: 'neutral' };

  const editingServer = draft?.id
    ? servers.find((server) => server.id === draft.id)
    : undefined;
  const editingStatus = editingServer
    ? serverStatusView(editingServer, statusById.get(editingServer.id), syncError)
    : null;

  const syncServers = useCallback(
    async (list: McpServerConfig[], announce: boolean) => {
      setIsSyncing(true);
      setSyncError(null);

      if (announce) {
        onError(null);
      }

      try {
        // Keep synthetic plugin records and the MCP tool registry in lockstep.
        const { tools } = await platform.syncMcpServers(list, {
          refreshTools: true,
        });

        if (!tools) {
          const message =
            'MCP sync failed. Plugin records were updated; tools were not refreshed.';

          setSyncError(message);
          if (announce) {
            onError(message);
          }
          return null;
        }

        setStatuses(tools.statuses);
        setToolCount(tools.toolCount);

        if (announce) {
          const failed = tools.statuses.find((status) => !status.ok);

          if (failed) {
            onError(`${failed.serverName}: ${failed.error ?? 'could not connect.'}`);
          } else if (tools.toolCount > 0) {
            onNotice(`MCP sync complete · ${toolLabel(tools.toolCount)} available.`);
          } else {
            onNotice('MCP sync complete — no tools found.');
          }
        }

        return tools;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'MCP sync failed.';

        setSyncError(message);
        if (announce) {
          onError(message);
        }

        return null;
      } finally {
        setIsSyncing(false);
      }
    },
    [platform, onError, onNotice]
  );

  function openEditor(server?: McpServerConfig) {
    onError(null);
    setFormError(null);
    setDraft(server ? { ...server } : { ...EMPTY_DRAFT });
  }

  function closeEditor() {
    setDraft(null);
    setFormError(null);
  }

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  async function saveDraft() {
    if (!draft || isSaving) {
      return;
    }

    if (!draft.url.trim()) {
      setFormError('Server URL is required.');
      return;
    }

    setIsSaving(true);
    setFormError(null);
    onError(null);

    try {
      const config = buildMcpServer({
        id: draft.id ?? undefined,
        name: draft.name,
        url: draft.url,
        token: draft.token,
        enabled: draft.enabled,
      });

      const next = draft.id
        ? servers.map((server) => (server.id === draft.id ? config : server))
        : [...servers, config];

      const saved = await saveMcpServers(next);
      setServers(saved);
      setDraft(null);
      onNotice(`${config.name} saved.`);

      const result = await syncServers(saved, false);

      if (config.enabled) {
        const status = result?.statuses.find((item) => item.serverId === config.id);

        if (status?.ok) {
          onNotice(
            `${config.name} connected · ${toolLabel(status.toolCount)} available.`
          );
        } else if (status) {
          onError(`${config.name}: ${status.error ?? 'could not connect.'}`);
        } else if (result) {
          onNotice(`${config.name} saved. Connection could not be confirmed.`);
        }
      }
    } catch {
      setFormError('Could not save the server. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  async function removeServer(server: McpServerConfig) {
    try {
      const saved = await saveMcpServers(
        servers.filter((item) => item.id !== server.id)
      );
      setServers(saved);

      if (draft?.id === server.id) {
        setDraft(null);
      }

      onNotice(`${server.name} removed.`);
      await syncServers(saved, false);
    } catch {
      onError('Could not remove the server.');
    }
  }

  function confirmRemove(server: McpServerConfig) {
    Alert.alert(
      'Remove server?',
      `Removing ${server.name} also removes its tools from the agent.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void removeServer(server);
          },
        },
      ]
    );
  }

  async function toggleServer(server: McpServerConfig, enabled: boolean) {
    const previous = servers;
    const next = servers.map((item) =>
      item.id === server.id ? { ...item, enabled } : item
    );

    setServers(next);
    onError(null);

    try {
      const saved = await saveMcpServers(next);
      setServers(saved);

      const result = await syncServers(saved, false);

      if (enabled && result) {
        const status = result.statuses.find((item) => item.serverId === server.id);

        if (status?.ok) {
          onNotice(`${server.name} enabled · ${toolLabel(status.toolCount)} available.`);
        } else if (status) {
          onError(`${server.name}: ${status.error ?? 'could not connect.'}`);
        } else {
          onNotice(`${server.name} enabled. Connection could not be confirmed.`);
        }
      } else if (!enabled) {
        onNotice(`${server.name} disabled.`);
      }
    } catch {
      setServers(previous);
      onError('Could not update the server.');
    }
  }

  return (
    <GlassView style={styles.card}>
      <SettingsSection
        title="MCP servers"
        description="Connect external tools — mail, files, PDFs. The agent uses them when needed."
        action={
          <StatusPill
            label={summary.label}
            tone={summary.tone}
            showDot={summary.tone === 'success' || summary.tone === 'danger'}
          />
        }
      >
        {servers.length === 0 ? (
          <EmptyState
            icon="server-outline"
            title="No MCP servers yet"
            message="Add a server with a streamable HTTP endpoint. A bearer token is optional."
            actionLabel="Add server"
            onAction={() => openEditor()}
          />
        ) : (
          <View style={styles.list}>
            {servers.map((server, index) => {
              const view = serverStatusView(
                server,
                statusById.get(server.id),
                syncError
              );
              const detailColor =
                view.detailTone === 'danger'
                  ? colors.danger
                  : view.detailTone === 'warning'
                    ? colors.warning
                    : colors.textMuted;

              return (
                <View
                  key={server.id}
                  style={[
                    styles.serverRow,
                    index === servers.length - 1 && styles.lastRow,
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit ${server.name}`}
                    onPress={() => openEditor(server)}
                    style={({ pressed }) => [
                      styles.serverMain,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.iconWrap}>
                      <Ionicons name="server-outline" size={17} color={colors.accent} />
                    </View>

                    <View style={styles.serverText}>
                      <Text numberOfLines={1} style={styles.serverName}>
                        {server.name}
                      </Text>
                      <Text numberOfLines={1} style={styles.serverUrl}>
                        {server.url}
                      </Text>
                      {view.detail ? (
                        <Text
                          numberOfLines={2}
                          style={[styles.serverDetail, { color: detailColor }]}
                        >
                          {view.detail}
                        </Text>
                      ) : null}
                    </View>

                    <View style={styles.statusColumn}>
                      <StatusPill
                        label={view.label}
                        tone={view.tone}
                        showDot={view.tone === 'success' || view.tone === 'danger'}
                      />
                    </View>

                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={colors.textFaint}
                    />
                  </Pressable>

                  <Switch
                    accessibilityLabel={`${server.name} enabled`}
                    value={server.enabled}
                    onValueChange={(value) => {
                      void toggleServer(server, value);
                    }}
                    trackColor={{ false: colors.border, true: colors.blue }}
                    thumbColor={colors.white}
                    ios_backgroundColor={colors.border}
                  />
                </View>
              );
            })}
          </View>
        )}

        {draft ? (
          <View style={styles.editor}>
            <View style={styles.editorHeader}>
              <Text style={styles.editorTitle}>
                {draft.id ? 'Edit server' : 'Add server'}
              </Text>
              {editingStatus ? (
                <StatusPill label={editingStatus.label} tone={editingStatus.tone} />
              ) : null}
            </View>

            <FormError message={formError} />

            <TextField
              label="Name"
              value={draft.name}
              onChangeText={(value) => updateDraft({ name: value })}
              placeholder="Gmail"
              autoCapitalize="words"
              autoCorrect={false}
              hint="A short label for this server."
            />

            <TextField
              label="Server URL"
              value={draft.url}
              onChangeText={(value) => updateDraft({ url: value })}
              placeholder="https://mcp.example.com/mcp"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              hint="Use a streamable HTTP endpoint."
            />

            <TextField
              label="Bearer token"
              value={draft.token}
              onChangeText={(value) => updateDraft({ token: value })}
              placeholder="optional token"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              hint="Optional. Stored encrypted on this device."
            />

            <View style={styles.toggleRow}>
              <View style={styles.toggleText}>
                <Text style={styles.toggleLabel}>Enabled</Text>
                <Text style={styles.toggleHint}>
                  Disabled servers remove their tools from the agent.
                </Text>
              </View>
              <Switch
                accessibilityLabel="Server enabled"
                value={draft.enabled}
                onValueChange={(value) => updateDraft({ enabled: value })}
                trackColor={{ false: colors.border, true: colors.blue }}
                thumbColor={colors.white}
                ios_backgroundColor={colors.border}
              />
            </View>

            <View style={styles.editorActions}>
              <Button
                label="Cancel"
                variant="secondary"
                onPress={closeEditor}
                disabled={isSaving}
                style={styles.flexButton}
              />
              <Button
                label={draft.id ? 'Save changes' : 'Add server'}
                onPress={() => {
                  void saveDraft();
                }}
                loading={isSaving || isSyncing}
                style={styles.flexButton}
              />
            </View>

            {draft.id ? (
              <Button
                label="Remove server"
                variant="danger"
                onPress={() => {
                  const server = servers.find((item) => item.id === draft.id);

                  if (server) {
                    confirmRemove(server);
                  }
                }}
                disabled={isSaving}
                style={styles.removeButton}
              />
            ) : null}
          </View>
        ) : servers.length > 0 ? (
          <View style={styles.footerRow}>
            <Button
              label="Add server"
              variant="secondary"
              onPress={() => openEditor()}
              style={styles.flexButton}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sync MCP tools"
              accessibilityState={{ disabled: isSyncing, busy: isSyncing }}
              disabled={isSyncing}
              onPress={() => {
                void syncServers(servers, true);
              }}
              style={({ pressed }) => [
                styles.syncButton,
                isSyncing && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="refresh-outline" size={17} color={colors.accent} />
              )}
              <Text style={styles.syncText}>Sync tools</Text>
            </Pressable>
          </View>
        ) : null}

        <Text style={styles.note}>
          MCP tools are available in cloud AI mode. Server results are treated as
          untrusted data.
        </Text>
      </SettingsSection>
    </GlassView>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    card: {
      padding: spacing.md + 2,
      marginTop: spacing.sm,
    },
    list: {
      gap: spacing.xs,
    },
    serverRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: layout.touchTarget + 20,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    lastRow: {
      borderBottomWidth: 0,
    },
    serverMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: 11,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    serverText: {
      flex: 1,
      gap: 2,
    },
    serverName: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    serverUrl: {
      color: colors.textFaint,
      ...typography.caption,
    },
    serverDetail: {
      ...typography.caption,
      fontWeight: '500',
    },
    statusColumn: {
      maxWidth: 112,
    },
    editor: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      padding: spacing.md,
      gap: spacing.md,
    },
    editorHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      minHeight: 28,
    },
    editorTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    toggleText: {
      flex: 1,
      gap: 2,
    },
    toggleLabel: {
      color: colors.text,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    toggleHint: {
      color: colors.textFaint,
      ...typography.caption,
    },
    editorActions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    flexButton: {
      flex: 1,
    },
    removeButton: {
      alignSelf: 'stretch',
    },
    footerRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    syncButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: layout.touchTarget + 4,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    syncText: {
      color: colors.accent,
      ...typography.button,
    },
    disabled: {
      opacity: 0.5,
    },
    pressed: {
      opacity: 0.78,
    },
    note: {
      color: colors.textFaint,
      ...typography.caption,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.sm,
    },
  });
