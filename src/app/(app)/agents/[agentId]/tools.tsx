import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormError } from '@/components/FormError';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import '@/lib/ai/tools';
import {
  defaultAgentConfig,
  deleteAgentConfig,
  loadAgentConfig,
  matchesToolPattern,
  saveAgentConfig,
  type AgentConfig,
  type AgentToolAccessMode,
} from '@/lib/agent-settings';
import { agentToolRegistry, type AgentToolDescriptor } from '@/lib/ai/tool-registry';
import {
  connectionLabel,
  listGoogleConnectionStates,
} from '@/lib/connections/google';
import type { GoogleConnectionId } from '@/lib/connections/types';
import { resolveAgentIdentity } from '@/lib/permissions/agents';
import type { AgentIdentity } from '@/lib/permissions';
import { fonts, radius, spacing } from '@/theme';

const INSTRUCTIONS_MAX = 4_000;
const MEMORY_MAX = 8_000;

type Params = { agentId?: string };

function sourceLabel(source: string | undefined): string {
  switch (source) {
    case 'plugin':
      return 'Plugin';
    case 'mcp':
      return 'MCP';
    case 'connection':
      return 'Connection';
    default:
      return 'Built-in';
  }
}

function connectionIdForTool(tool: AgentToolDescriptor): GoogleConnectionId | null {
  const pluginId = tool.meta?.pluginId;

  if (pluginId === 'connection.gmail') {
    return 'gmail';
  }

  if (pluginId === 'connection.google_calendar') {
    return 'google_calendar';
  }

  if (pluginId === 'connection.google_drive') {
    return 'google_drive';
  }

  return null;
}

export default function AgentToolsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const db = useSQLiteContext();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const params = useLocalSearchParams<Params>();
  const rawId = params.agentId;
  const agentId = typeof rawId === 'string' ? decodeURIComponent(rawId) : '';

  const [agent, setAgent] = useState<AgentIdentity | null>(null);
  const [config, setConfig] = useState<AgentConfig | null>(null);
  const [descriptors, setDescriptors] = useState<AgentToolDescriptor[]>([]);
  const [disconnected, setDisconnected] = useState<Set<GoogleConnectionId>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!user || !agentId) {
        return;
      }

      let active = true;
      setLoading(true);

      void (async () => {
        try {
          const [identity, settings, connections] = await Promise.all([
            resolveAgentIdentity(db, user.id, agentId),
            loadAgentConfig(db, user.id, agentId),
            listGoogleConnectionStates(user.id, false),
          ]);

          if (!active) {
            return;
          }

          setAgent(identity);
          setConfig(settings);
          setDescriptors(agentToolRegistry.descriptors());
          setDisconnected(
            new Set(
              connections
                .filter((state) => state.status !== 'connected')
                .map((state) => state.id)
            )
          );
          setError(null);
        } catch (loadError) {
          if (active) {
            setError(
              loadError instanceof Error ? loadError.message : 'Could not load agent settings.'
            );
          }
        } finally {
          if (active) {
            setLoading(false);
          }
        }
      })();

      return () => {
        active = false;
      };
    }, [agentId, db, user])
  );

  const sorted = useMemo(
    () =>
      [...descriptors].sort((a, b) => {
        const sourceCompare = sourceLabel(a.meta?.source).localeCompare(
          sourceLabel(b.meta?.source)
        );
        return sourceCompare || a.definition.name.localeCompare(b.definition.name);
      }),
    [descriptors]
  );

  if (!user) {
    return null;
  }

  function toggleTool(name: string, enabled: boolean) {
    setConfig((current) => {
      if (!current) {
        return current;
      }

      const kept = current.allowedTools.filter((pattern) =>
        enabled ? true : !matchesToolPattern(pattern, name)
      );

      return {
        ...current,
        allowedTools: enabled
          ? Array.from(new Set([...kept, name])).sort((a, b) => a.localeCompare(b))
          : kept,
      };
    });
  }

  async function save() {
    if (!config || !user || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const saved = await saveAgentConfig(db, user.id, agentId, {
        instructions: config.instructions,
        memory: config.memory,
        toolAccessMode: config.toolAccessMode,
        allowedTools: config.allowedTools,
      });
      setConfig(saved);
      setNotice('Saved. New chats with this agent use these settings.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save agent settings.');
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!user) {
      return;
    }

    try {
      await deleteAgentConfig(db, user.id, agentId);
      setConfig(defaultAgentConfig(user.id, agentId));
      setNotice('Reset to the default safe tool list.');
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset agent settings.');
    }
  }

  return (
    <View style={styles.root}>
      <GlassBackdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="Agent settings"
          title={agent ? `${agent.name} tools` : 'Agent tools'}
          subtitle="Instructions and memory are private to this agent. Tools stay off until they appear in the allowlist."
          left={<SidebarButton onPress={openSidebar} />}
        />

        <FormError message={error} onDismiss={() => setError(null)} />
        {notice ? (
          <View style={styles.notice}>
            <Ionicons name="checkmark-circle-outline" size={17} color={colors.success} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        {loading || !config ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <>
            <GlassView style={styles.section}>
              <Text style={styles.sectionTitle}>Instructions</Text>
              <Text style={styles.hint}>
                Added to every request for this agent. Do not paste secrets here.
              </Text>
              <TextInput
                value={config.instructions}
                onChangeText={(text) =>
                  setConfig({ ...config, instructions: text.slice(0, INSTRUCTIONS_MAX) })
                }
                placeholder="How should this agent behave?"
                placeholderTextColor={colors.textFaint}
                multiline
                style={styles.textArea}
                accessibilityLabel="Agent instructions"
              />
              <Text style={styles.counter}>{config.instructions.length}/{INSTRUCTIONS_MAX}</Text>

              <Text style={styles.sectionTitle}>Memory</Text>
              <Text style={styles.hint}>Notes the agent can recall in this workspace.</Text>
              <TextInput
                value={config.memory}
                onChangeText={(text) => setConfig({ ...config, memory: text.slice(0, MEMORY_MAX) })}
                placeholder="Durable notes, preferences and context"
                placeholderTextColor={colors.textFaint}
                multiline
                style={styles.textArea}
                accessibilityLabel="Agent memory"
              />
              <Text style={styles.counter}>{config.memory.length}/{MEMORY_MAX}</Text>
            </GlassView>

            <GlassView style={styles.section}>
              <Text style={styles.sectionTitle}>Tool access</Text>
              <Text style={styles.hint}>
                Selected only allows the tools below. All permits every registered tool, but
                sensitive actions still require approval.
              </Text>
              <View style={styles.modeRow}>
                {(['selected', 'all'] as AgentToolAccessMode[]).map((mode) => (
                  <Pressable
                    key={mode}
                    accessibilityRole="button"
                    accessibilityState={{ selected: config.toolAccessMode === mode }}
                    onPress={() => setConfig({ ...config, toolAccessMode: mode })}
                    style={[
                      styles.modeButton,
                      config.toolAccessMode === mode && styles.modeButtonActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.modeText,
                        config.toolAccessMode === mode && styles.modeTextActive,
                      ]}
                    >
                      {mode === 'selected' ? 'Selected tools' : 'All tools'}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </GlassView>

            <View style={styles.toolList}>
              {sorted.map((tool) => {
                const name = tool.definition.name;
                const allowed =
                  config.toolAccessMode === 'all' ||
                  config.allowedTools.some((pattern) => matchesToolPattern(pattern, name));
                const connectionId = connectionIdForTool(tool);
                const needsConnection = Boolean(connectionId && disconnected.has(connectionId));

                return (
                  <GlassView key={name} style={styles.toolCard}>
                    <View style={styles.toolTop}>
                      <View style={styles.toolCopy}>
                        <Text style={styles.toolName}>{name}</Text>
                        <Text style={styles.toolDescription} numberOfLines={2}>
                          {tool.definition.description || 'No description provided.'}
                        </Text>
                        <Text style={styles.toolSource}>
                          {sourceLabel(tool.meta?.source)}
                          {tool.meta?.permissions?.length
                            ? ` · ${tool.meta.permissions.join(', ')}`
                            : ''}
                        </Text>
                        {needsConnection && allowed ? (
                          <Text style={styles.connectionWarning}>
                            {connectionId ? connectionLabel(connectionId) : 'Account'} is not
                            connected. Connect it in Connections before use.
                          </Text>
                        ) : null}
                      </View>
                      <Switch
                        accessibilityLabel={`Allow ${name}`}
                        value={allowed}
                        onValueChange={(next) => toggleTool(name, next)}
                        trackColor={{ false: colors.surfaceAlt, true: colors.accentSoft }}
                        thumbColor={allowed ? colors.accent : colors.textFaint}
                      />
                    </View>
                  </GlassView>
                );
              })}
            </View>

            <View style={styles.actions}>
              <Button label="Save settings" onPress={() => void save()} loading={saving} />
              <Button
                label="Reset to defaults"
                variant="secondary"
                onPress={() => void reset()}
                disabled={saving}
              />
            </View>
          </>
        )}

        <Text style={styles.note}>
          Tool access is not a permission grant. Google writes, MCP calls and plugin tools still
          pass through the approval flow at execution time.
        </Text>
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
    loading: {
      paddingVertical: spacing.xl,
      alignItems: 'center',
    },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.successSoft,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    noticeText: {
      flex: 1,
      color: colors.success,
      fontSize: 13,
    },
    section: {
      padding: spacing.md,
      gap: spacing.sm,
    },
    sectionTitle: {
      color: colors.text,
      fontFamily: fonts.serif,
      fontSize: 19,
      fontWeight: '600',
    },
    hint: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
    },
    textArea: {
      minHeight: 104,
      maxHeight: 220,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      padding: spacing.md,
      fontSize: 14,
      lineHeight: 20,
      textAlignVertical: 'top',
    },
    counter: {
      alignSelf: 'flex-end',
      color: colors.textFaint,
      fontSize: 11,
    },
    modeRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    modeButton: {
      flex: 1,
      minHeight: 44,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modeButtonActive: {
      backgroundColor: colors.accentSoft,
    },
    modeText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    modeTextActive: {
      color: colors.accent,
    },
    toolList: {
      gap: spacing.sm,
    },
    toolCard: {
      padding: spacing.md,
    },
    toolTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    toolCopy: {
      flex: 1,
      gap: 3,
    },
    toolName: {
      color: colors.text,
      fontFamily: fonts.mono,
      fontSize: 13,
      fontWeight: '600',
    },
    toolDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    toolSource: {
      color: colors.textFaint,
      fontSize: 11,
    },
    connectionWarning: {
      color: colors.warning,
      fontSize: 12,
      lineHeight: 17,
      marginTop: spacing.xs,
    },
    actions: {
      gap: spacing.sm,
    },
    note: {
      color: colors.textFaint,
      fontSize: 12,
      lineHeight: 18,
      textAlign: 'center',
    },
  });
