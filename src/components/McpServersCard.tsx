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
import { FormError } from '@/components/FormError';
import { GlassView } from '@/components/GlassView';
import { TextField } from '@/components/TextField';
import {
  getMcpStatuses,
  getMcpToolCount,
  refreshMcpTools,
  type McpServerSyncStatus,
} from '@/lib/mcp/registry';
import {
  buildMcpServer,
  loadMcpServers,
  saveMcpServers,
  type McpServerConfig,
} from '@/lib/mcp/settings';
import { radius, spacing } from '@/theme';


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

export function McpServersCard({ onNotice, onError }: McpServersCardProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const [servers, setServers] = useState<McpServerConfig[]>([]);
  const [statuses, setStatuses] = useState<McpServerSyncStatus[]>([]);
  const [toolCount, setToolCount] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void (async () => {
        const list = await loadMcpServers();

        if (active) {
          setServers(list);
          setStatuses(getMcpStatuses());
          setToolCount(getMcpToolCount());
        }
      })();

      return () => {
        active = false;
      };
    }, [])
  );

  const statusById = useMemo(
    () => new Map(statuses.map((status) => [status.serverId, status])),
    [statuses]
  );

  const enabledCount = servers.filter((server) => server.enabled).length;

  const syncServers = useCallback(
    async (list: McpServerConfig[], announce: boolean) => {
      setIsSyncing(true);

      if (announce) {
        onError(null);
      }

      try {
        const result = await refreshMcpTools(list);
        setStatuses(result.statuses);
        setToolCount(result.toolCount);

        if (announce) {
          const failed = result.statuses.find((status) => !status.ok);

          if (failed) {
            onError(`${failed.serverName}: ${failed.error ?? 'connect nahi hua.'}`);
          } else if (result.toolCount > 0) {
            onNotice(`MCP sync complete · ${toolLabel(result.toolCount)} available.`);
          } else {
            onNotice('MCP sync complete — koi tool nahi mila.');
          }
        }

        return result;
      } catch (syncError) {
        if (announce) {
          onError(
            syncError instanceof Error ? syncError.message : 'MCP sync fail ho gaya.'
          );
        }

        return null;
      } finally {
        setIsSyncing(false);
      }
    },
    [onError, onNotice]
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
      setFormError('Server URL required hai.');
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
      onNotice(
        config.enabled
          ? `${config.name} saved. Tools sync ho rahe hain…`
          : `${config.name} saved (disabled).`
      );

      if (config.enabled) {
        const result = await syncServers(saved, false);
        const status = result?.statuses.find((item) => item.serverId === config.id);

        if (status?.ok) {
          onNotice(`${config.name} connected · ${toolLabel(status.toolCount)} available.`);
        } else if (status) {
          onError(`${config.name}: ${status.error ?? 'connect nahi hua.'}`);
        }
      }
    } catch {
      setFormError('Server save nahi hua. Dobara try karo.');
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

      onNotice(`${server.name} remove ho gaya.`);
      await syncServers(saved, false);
    } catch {
      onError('Server remove nahi ho paya.');
    }
  }

  function confirmRemove(server: McpServerConfig) {
    Alert.alert(
      'Remove server?',
      `${server.name} ke saare tools agent se hat jayenge.`,
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
          onError(`${server.name}: ${status.error ?? 'connect nahi hua.'}`);
        }
      } else if (!enabled) {
        onNotice(`${server.name} disabled.`);
      }
    } catch {
      setServers(previous);
      onError('Server update nahi hua.');
    }
  }

  return (
    <GlassView style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.headerText}>
          <Text style={styles.title}>MCP servers</Text>
          <Text style={styles.caption}>
            External tools connect karo — mail, files, PDFs. Agent unhe zarurat par
            use karega.
          </Text>
        </View>

        <View style={[styles.badge, toolCount > 0 ? styles.badgeOn : styles.badgeOff]}>
          <Text
            style={[
              styles.badgeText,
              { color: toolCount > 0 ? colors.success : colors.textMuted },
            ]}
          >
            {toolCount > 0 ? `${toolCount} TOOLS` : enabledCount > 0 ? 'SYNC' : 'NONE'}
          </Text>
        </View>
      </View>

      {servers.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons
            name="extension-puzzle-outline"
            size={20}
            color={colors.textFaint}
          />
          <Text style={styles.emptyText}>
            Koi server add nahi kiya. Endpoint URL aur optional bearer token chahiye.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {servers.map((server) => {
            const status = statusById.get(server.id);
            const label = !server.enabled
              ? 'Disabled'
              : status
                ? status.ok
                  ? `${toolLabel(status.toolCount)} available`
                  : `Connection failed — ${status.error ?? 'unknown error'}`
                : 'Not synced yet';
            const tone = !server.enabled
              ? colors.textFaint
              : status
                ? status.ok
                  ? colors.success
                  : colors.danger
                : colors.textMuted;

            return (
              <View key={server.id} style={styles.serverRow}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${server.name}`}
                  onPress={() => openEditor(server)}
                  style={({ pressed }) => [
                    styles.serverMain,
                    pressed && styles.pressed,
                  ]}
                >
                  <View style={[styles.dot, { backgroundColor: tone }]} />

                  <View style={styles.serverText}>
                    <Text numberOfLines={1} style={styles.serverName}>
                      {server.name}
                    </Text>
                    <Text numberOfLines={1} style={styles.serverUrl}>
                      {server.url}
                    </Text>
                    <Text numberOfLines={2} style={[styles.serverStatus, { color: tone }]}>
                      {label}
                    </Text>
                  </View>

                  <Ionicons name="create-outline" size={17} color={colors.textFaint} />
                </Pressable>

                <Switch
                  accessibilityLabel={`${server.name} enabled`}
                  value={server.enabled}
                  onValueChange={(value) => {
                    void toggleServer(server, value);
                  }}
                  trackColor={{ false: colors.border, true: 'rgba(62, 224, 161, 0.4)' }}
                  thumbColor={server.enabled ? colors.success : colors.textMuted}
                  ios_backgroundColor={colors.border}
                />
              </View>
            );
          })}
        </View>
      )}

      {draft ? (
        <GlassView style={styles.editor}>
          <Text style={styles.editorTitle}>
            {draft.id ? 'Edit server' : 'Add server'}
          </Text>

          <FormError message={formError} />

          <TextField
            label="Name"
            value={draft.name}
            onChangeText={(value) => updateDraft({ name: value })}
            placeholder="Gmail"
            autoCapitalize="words"
            autoCorrect={false}
          />

          <TextField
            label="Server URL"
            value={draft.url}
            onChangeText={(value) => updateDraft({ url: value })}
            placeholder="https://mcp.example.com/mcp"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            hint="Streamable HTTP endpoint."
          />

          <TextField
            label="Bearer token"
            value={draft.token}
            onChangeText={(value) => updateDraft({ token: value })}
            placeholder="optional token"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            hint="Optional. Token encrypted SecureStore me save hota hai."
          />

          <View style={styles.toggleRow}>
            <View style={styles.toggleText}>
              <Text style={styles.toggleLabel}>Enabled</Text>
              <Text style={styles.toggleHint}>
                Off karne par tools agent se hat jayenge.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Server enabled"
              value={draft.enabled}
              onValueChange={(value) => updateDraft({ enabled: value })}
              trackColor={{ false: colors.border, true: 'rgba(62, 224, 161, 0.4)' }}
              thumbColor={draft.enabled ? colors.success : colors.textMuted}
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
              label={draft.id ? 'Save' : 'Add'}
              onPress={() => {
                void saveDraft();
              }}
              loading={isSaving}
              style={styles.flexButton}
            />
          </View>

          {draft.id ? (
            <Pressable
              accessibilityRole="button"
              disabled={isSaving}
              onPress={() => {
                const server = servers.find((item) => item.id === draft.id);

                if (server) {
                  confirmRemove(server);
                }
              }}
              style={({ pressed }) => [styles.remove, pressed && styles.pressed]}
            >
              <Ionicons name="trash-outline" size={13} color={colors.danger} />
              <Text style={styles.removeText}>Remove server</Text>
            </Pressable>
          ) : null}
        </GlassView>
      ) : (
        <View style={styles.footerRow}>
          <Pressable
            accessibilityRole="button"
            onPress={() => openEditor()}
            style={({ pressed }) => [styles.addButton, pressed && styles.pressed]}
          >
            <Ionicons name="add" size={16} color={colors.accent} />
            <Text style={styles.addText}>Add server</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sync MCP tools"
            disabled={isSyncing || servers.length === 0}
            onPress={() => {
              void syncServers(servers, true);
            }}
            style={({ pressed }) => [
              styles.syncButton,
              (isSyncing || servers.length === 0) && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {isSyncing ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Ionicons
                name="refresh"
                size={15}
                color={servers.length === 0 ? colors.textFaint : colors.accent}
              />
            )}
            <Text
              style={[
                styles.syncText,
                { color: servers.length === 0 ? colors.textFaint : colors.accent },
              ]}
            >
              Sync
            </Text>
          </Pressable>
        </View>
      )}

      <Text style={styles.note}>
        MCP tools cloud AI mode me available hote hain. Server results untrusted data
        ki tarah treat hote hain.
      </Text>
    </GlassView>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
  card: {
    padding: spacing.md + 2,
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  headerText: {
    flex: 1,
    gap: 4,
  },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  caption: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeOn: {
    backgroundColor: colors.successSoft,
  },
  badgeOff: {
    backgroundColor: colors.surfaceAlt,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  empty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: glass.fillSoft,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: glass.border,
    borderTopColor: glass.borderBright,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  emptyText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  list: {
    gap: spacing.sm,
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: glass.fillSoft,
    borderWidth: 1,
    borderColor: glass.border,
    borderTopColor: glass.borderBright,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.sm,
  },
  serverMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  serverText: {
    flex: 1,
    gap: 2,
  },
  serverName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  serverUrl: {
    color: colors.textFaint,
    fontSize: 11,
  },
  serverStatus: {
    fontSize: 11,
    fontWeight: '500',
  },
  editor: {
    borderColor: 'rgba(109, 139, 255, 0.35)',
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.md,
  },
  editorTitle: {
    color: colors.text,
    fontSize: 14,
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
    fontSize: 13,
    fontWeight: '600',
  },
  toggleHint: {
    color: colors.textFaint,
    fontSize: 11,
    lineHeight: 16,
  },
  editorActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  flexButton: {
    flex: 1,
  },
  remove: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 4,
  },
  removeText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  footerRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  addButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderFocus,
    backgroundColor: 'rgba(109, 139, 255, 0.14)',
    borderTopColor: glass.borderBright,
  },
  addText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  syncButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: glass.border,
    borderTopColor: glass.borderBright,
    backgroundColor: glass.fill,
  },
  syncText: {
    fontSize: 13,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.78,
  },
  note: {
    color: colors.textFaint,
    fontSize: 11,
    lineHeight: 16,
    borderTopWidth: 1,
    borderTopColor: glass.border,
    paddingTop: spacing.sm,
  },
  });
