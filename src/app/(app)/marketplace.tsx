import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useFocusEffect, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FormError } from '@/components/FormError';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SettingsSection } from '@/components/SettingsSection';
import { SidebarButton } from '@/components/SidebarButton';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
import { usePluginActions } from '@/components/plugins/usePluginActions';
import { useSession } from '@/context/auth';
import { usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import '@/lib/ai/tools';
import { agentToolRegistry, type AgentToolDescriptor } from '@/lib/ai/tool-registry';
import { listGoogleConnectionStates } from '@/lib/connections/google';
import type { ConnectionState } from '@/lib/connections/types';
import { getMcpStatuses, getMcpToolCount } from '@/lib/mcp/registry';
import type { PluginSummary } from '@/lib/plugins/types';
import { radius, spacing, typography } from '@/theme';

type Filter = 'all' | 'plugins' | 'tools' | 'installed';

type ToolRow = {
  tool: AgentToolDescriptor;
  connected: boolean | null;
};

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'plugins', label: 'Plugins' },
  { id: 'tools', label: 'Tools' },
  { id: 'installed', label: 'Installed' },
];

function sourceLabel(source: string | undefined): string {
  switch (source) {
    case 'plugin':
      return 'Plugin';
    case 'mcp':
      return 'MCP';
    case 'connection':
      return 'Account';
    default:
      return 'Built-in';
  }
}

function isInstalled(summary: PluginSummary): boolean {
  return (
    summary.status !== 'discovered' &&
    summary.status !== 'available' &&
    summary.status !== 'installing'
  );
}

function pluginStatus(summary: PluginSummary): { label: string; tone: StatusTone } {
  if (summary.legacy) {
    return { label: 'Legacy', tone: 'danger' };
  }

  switch (summary.status) {
    case 'running':
      return { label: 'Running', tone: 'success' };
    case 'error':
      return { label: 'Error', tone: 'danger' };
    case 'disabled':
      return { label: 'Disabled', tone: 'neutral' };
    case 'available':
      return { label: 'Available', tone: 'accent' };
    case 'installed':
    case 'enabled':
      return { label: 'Installed', tone: 'info' };
    case 'installing':
      return { label: 'Installing…', tone: 'warning' };
    default:
      return isInstalled(summary)
        ? { label: 'Installed', tone: 'info' }
        : { label: 'Available', tone: 'accent' };
  }
}

export default function MarketplaceScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const snapshot = usePluginSnapshot();
  const actions = usePluginActions();
  const params = useLocalSearchParams<{ q?: string }>();
  const [query, setQuery] = useState(typeof params.q === 'string' ? params.q : '');
  const [filter, setFilter] = useState<Filter>('all');
  const [connections, setConnections] = useState<ConnectionState[]>([]);
  const [descriptors, setDescriptors] = useState<AgentToolDescriptor[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(
    useCallback(() => {
      if (!user) {
        return;
      }

      let active = true;

      void (async () => {
        try {
          const states = await listGoogleConnectionStates(user.id, false);
          if (active) {
            setConnections(states);
            setDescriptors(agentToolRegistry.descriptors());
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
    }, [user])
  );

  const term = query.trim().toLowerCase();

  const plugins = useMemo(
    () =>
      snapshot.summaries.filter((summary) => {
        if (filter === 'installed' && !isInstalled(summary)) {
          return false;
        }

        return (
          !term ||
          summary.manifest.name.toLowerCase().includes(term) ||
          summary.manifest.description.toLowerCase().includes(term) ||
          summary.manifest.category.toLowerCase().includes(term)
        );
      }),
    [filter, snapshot.summaries, term]
  );

  const tools = useMemo<ToolRow[]>(() => {
    if (filter === 'installed' || filter === 'plugins') {
      return [];
    }

    return descriptors
      .filter((descriptor) => {
        if (!term) {
          return true;
        }

        return (
          descriptor.definition.name.toLowerCase().includes(term) ||
          (descriptor.definition.description ?? '').toLowerCase().includes(term) ||
          sourceLabel(descriptor.meta?.source).toLowerCase().includes(term)
        );
      })
      .map((descriptor) => {
        const pluginId = descriptor.meta?.pluginId ?? '';
        const id = pluginId.replace('connection.', '') as ConnectionState['id'];
        const state = connections.find((item) => item.id === id);

        return {
          tool: descriptor,
          connected: state ? state.status === 'connected' : null,
        };
      });
  }, [connections, descriptors, filter, term]);

  if (!user) {
    return null;
  }

  const mcpStatuses = getMcpStatuses();
  const toolCount = getMcpToolCount();

  function resetFilters() {
    setQuery('');
    setFilter('all');
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
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="Tool marketplace"
          title="Discover tools"
          subtitle="Browse bundled plugins, MCP servers and connected account actions. No code is downloaded from a remote store."
          left={<SidebarButton onPress={openSidebar} />}
        />

        <FormError message={actions.error} onDismiss={actions.clear} />
        {actions.notice ? (
          <View style={styles.notice}>
            <Ionicons name="checkmark-circle-outline" size={17} color={colors.success} />
            <Text style={styles.noticeText}>{actions.notice}</Text>
          </View>
        ) : null}

        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={colors.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search tools and plugins"
            placeholderTextColor={colors.textFaint}
            accessibilityLabel="Search tools and plugins"
            style={styles.search}
          />
          {query ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              hitSlop={10}
              onPress={() => setQuery('')}
            >
              <Ionicons name="close-circle" size={18} color={colors.textFaint} />
            </Pressable>
          ) : null}
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
          {FILTERS.map((item) => {
            const selected = filter === item.id;

            return (
              <Pressable
                key={item.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setFilter(item.id)}
                style={[
                  styles.filter,
                  selected && styles.filterActive,
                ]}
              >
                <Text style={[styles.filterText, selected && styles.filterTextActive]}>
                  {item.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {(filter === 'all' || filter === 'plugins' || filter === 'installed') && (
          <GlassView style={styles.panel}>
            <SettingsSection
              title="Plugins"
              description="Bundled extensions available on this device."
              action={
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/plugins' as Href)}
                  style={styles.sectionAction}
                >
                  <Text style={styles.sectionActionText}>Manage</Text>
                </Pressable>
              }
            >
              {plugins.length === 0 ? (
                <EmptyState
                  icon="extension-puzzle-outline"
                  title="No plugins found"
                  message="No bundled plugins match this search or filter."
                  actionLabel="Clear filters"
                  onAction={resetFilters}
                />
              ) : (
                <View style={styles.list}>
                  {plugins.map((summary) => {
                    const installed = isInstalled(summary);
                    const busy = actions.busyPluginId === summary.manifest.pluginId;
                    const pluginId = summary.manifest.pluginId;
                    const state = pluginStatus(summary);

                    return (
                      <View key={pluginId} style={styles.card}>
                        <View style={styles.cardTop}>
                          <View style={styles.iconWrap}>
                            <Ionicons
                              name="extension-puzzle-outline"
                              size={20}
                              color={colors.accent}
                            />
                          </View>
                          <View style={styles.cardCopy}>
                            <Text style={styles.cardTitle}>
                              {summary.manifest.name}
                            </Text>
                            <Text style={styles.cardDescription} numberOfLines={2}>
                              {summary.manifest.description}
                            </Text>
                            <View style={styles.metaRow}>
                              <StatusPill
                                label={state.label}
                                tone={state.tone}
                                showDot={
                                  state.tone === 'success' || state.tone === 'danger'
                                }
                              />
                              <Text style={styles.cardMeta}>
                                v{summary.manifest.version} · {summary.trustLevel}
                              </Text>
                            </View>
                          </View>
                        </View>

                        <View style={styles.cardActions}>
                          {!installed ? (
                            <Button
                              label="Install"
                              onPress={() => void actions.install(pluginId)}
                              disabled={busy}
                              loading={busy}
                            />
                          ) : summary.enabled ? (
                            <Button
                              label="Disable"
                              variant="secondary"
                              onPress={() => void actions.disable(pluginId)}
                              disabled={busy}
                              loading={busy}
                            />
                          ) : (
                            <Button
                              label="Enable"
                              onPress={() => void actions.enable(pluginId)}
                              disabled={busy}
                              loading={busy}
                            />
                          )}
                          <Button
                            label="Details"
                            variant="ghost"
                            onPress={() =>
                              router.push(
                                `/plugins/${encodeURIComponent(pluginId)}` as Href
                              )
                            }
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}
            </SettingsSection>
          </GlassView>
        )}

        {(filter === 'all' || filter === 'tools') && (
          <GlassView style={styles.panel}>
            <SettingsSection
              title="Available agent tools"
              description="Built-in, plugin, MCP and connected account actions."
              action={
                <Pressable
                  accessibilityRole="button"
                  onPress={() => router.push('/connections' as Href)}
                  style={styles.sectionAction}
                >
                  <Text style={styles.sectionActionText}>Connections</Text>
                </Pressable>
              }
            >
              {loading ? (
                <View style={styles.loading}>
                  <ActivityIndicator color={colors.accent} />
                </View>
              ) : tools.length === 0 ? (
                <EmptyState
                  icon="construct-outline"
                  title="No tools found"
                  message="Try a different search term or clear the filters."
                  actionLabel="Clear filters"
                  onAction={resetFilters}
                />
              ) : (
                <View style={styles.list}>
                  {tools.map(({ tool, connected }) => {
                    const name = tool.definition.name;

                    return (
                      <View key={name} style={styles.toolCard}>
                        <View style={styles.toolTop}>
                          <Text style={styles.toolName}>{name}</Text>
                          <StatusPill label={sourceLabel(tool.meta?.source)} tone="info" />
                          {connected === false ? (
                            <StatusPill label="Connect account" tone="warning" />
                          ) : connected === true ? (
                            <StatusPill label="Connected" tone="success" />
                          ) : null}
                        </View>
                        <Text style={styles.cardDescription} numberOfLines={3}>
                          {tool.definition.description || 'No description provided.'}
                        </Text>
                        {connected === false ? (
                          <Text style={styles.warning}>
                            Connect the account in Connections before agents can use this tool.
                          </Text>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              )}
            </SettingsSection>
          </GlassView>
        )}

        {filter === 'all' ? (
          <GlassView style={styles.panel}>
            <SettingsSection
              title="MCP discovery"
              description="Add servers in Connections. Each server is validated and its tools are registered through the existing MCP client."
              action={
                <StatusPill
                  label={toolCount === 1 ? '1 tool' : `${toolCount} tools`}
                  tone={toolCount > 0 ? 'success' : 'neutral'}
                />
              }
            >
              {mcpStatuses.length === 0 ? (
                <EmptyState
                  icon="server-outline"
                  title="No MCP servers configured"
                  message="Add a server in Connections to register its tools here."
                  actionLabel="Open Connections"
                  onAction={() => router.push('/connections' as Href)}
                />
              ) : (
                <View style={styles.list}>
                  {mcpStatuses.map((status) => (
                    <View key={status.serverId} style={styles.mcpRow}>
                      <StatusPill
                        label={status.ok ? 'Connected' : 'Failed'}
                        tone={status.ok ? 'success' : 'danger'}
                        showDot
                      />
                      <View style={styles.mcpCopy}>
                        <Text style={styles.mcpName}>{status.serverName}</Text>
                        <Text style={styles.cardMeta}>
                          {status.toolCount === 1 ? '1 tool' : `${status.toolCount} tools`}
                          {status.error ? ` · ${status.error}` : ''}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </SettingsSection>
          </GlassView>
        ) : null}
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
      paddingHorizontal: spacing.md,
      gap: spacing.md,
    },
    searchWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      minHeight: 50,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: spacing.md,
    },
    search: {
      flex: 1,
      color: colors.text,
      ...typography.body,
    },
    filters: {
      flexGrow: 0,
    },
    filter: {
      paddingHorizontal: spacing.md,
      paddingVertical: 9,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      marginRight: spacing.sm,
    },
    filterActive: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    filterText: {
      color: colors.textMuted,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    filterTextActive: {
      color: colors.accent,
    },
    panel: {
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    sectionAction: {
      paddingVertical: spacing.xs,
    },
    sectionActionText: {
      color: colors.accent,
      ...typography.bodySmall,
      fontWeight: '700',
    },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.success,
      backgroundColor: colors.successSoft,
      paddingVertical: spacing.sm,
      paddingHorizontal: spacing.md,
    },
    noticeText: {
      flex: 1,
      color: colors.success,
      ...typography.bodySmall,
    },
    loading: {
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
    list: {
      gap: spacing.sm,
    },
    card: {
      padding: spacing.sm + 2,
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    iconWrap: {
      width: 38,
      height: 38,
      borderRadius: 11,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardCopy: {
      flex: 1,
      gap: 3,
    },
    cardTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    cardDescription: {
      color: colors.textMuted,
      ...typography.caption,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    cardMeta: {
      flexShrink: 1,
      color: colors.textFaint,
      ...typography.caption,
      fontSize: 11,
    },
    cardActions: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    toolCard: {
      gap: 4,
      paddingVertical: spacing.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    toolTop: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    toolName: {
      flexShrink: 1,
      color: colors.text,
      ...typography.bodySmall,
      fontWeight: '700',
    },
    warning: {
      color: colors.warning,
      ...typography.caption,
    },
    mcpRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      paddingVertical: spacing.xs,
    },
    mcpCopy: {
      flex: 1,
      gap: 2,
    },
    mcpName: {
      color: colors.text,
      ...typography.bodySmall,
      fontWeight: '600',
    },
  });
