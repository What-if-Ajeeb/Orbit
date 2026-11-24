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
import '@/lib/ai/tools';
import { agentToolRegistry, type AgentToolDescriptor } from '@/lib/ai/tool-registry';
import { listGoogleConnectionStates } from '@/lib/connections/google';
import type { ConnectionState } from '@/lib/connections/types';
import { getMcpStatuses, getMcpToolCount } from '@/lib/mcp/registry';
import type { PluginSummary } from '@/lib/plugins/types';
import { radius, spacing } from '@/theme';

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

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search tools and plugins"
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="Search tools and plugins"
          style={styles.search}
        />

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters}>
          {FILTERS.map((item) => (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityState={{ selected: filter === item.id }}
              onPress={() => setFilter(item.id)}
              style={[
                styles.filter,
                filter === item.id && styles.filterActive,
              ]}
            >
              <Text style={[styles.filterText, filter === item.id && styles.filterTextActive]}>
                {item.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {(filter === 'all' || filter === 'plugins' || filter === 'installed') && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Plugins</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/plugins' as Href)}
                style={styles.sectionAction}
              >
                <Text style={styles.sectionActionText}>Manage</Text>
              </Pressable>
            </View>

            {plugins.length === 0 ? (
              <Text style={styles.emptyText}>
                No plugins match this search. Bundled plugins are available on this device.
              </Text>
            ) : (
              plugins.map((summary) => {
                const installed = isInstalled(summary);
                const busy = actions.busyPluginId === summary.manifest.pluginId;
                const pluginId = summary.manifest.pluginId;

                return (
                  <GlassView key={pluginId} style={styles.card}>
                    <View style={styles.cardTop}>
                      <View style={styles.iconWrap}>
                        <Ionicons name="extension-puzzle-outline" size={21} color={colors.accent} />
                      </View>
                      <View style={styles.cardCopy}>
                        <Text style={styles.cardTitle}>{summary.manifest.name}</Text>
                        <Text style={styles.cardDescription} numberOfLines={2}>
                          {summary.manifest.description}
                        </Text>
                        <Text style={styles.cardMeta}>
                          {summary.manifest.category} · v{summary.manifest.version} ·{' '}
                          {summary.trustLevel}
                        </Text>
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
                          router.push(`/plugins/${encodeURIComponent(pluginId)}` as Href)
                        }
                      />
                    </View>
                  </GlassView>
                );
              })
            )}
          </View>
        )}

        {(filter === 'all' || filter === 'tools') && (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Available agent tools</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/connections' as Href)}
                style={styles.sectionAction}
              >
                <Text style={styles.sectionActionText}>Connections</Text>
              </Pressable>
            </View>

            {loading ? (
              <View style={styles.loading}>
                <ActivityIndicator color={colors.accent} />
              </View>
            ) : tools.length === 0 ? (
              <Text style={styles.emptyText}>No tools match this search.</Text>
            ) : (
              tools.map(({ tool, connected }) => {
                const name = tool.definition.name;

                return (
                  <GlassView key={name} style={styles.card}>
                    <View style={styles.toolTop}>
                      <Text style={styles.toolName}>{name}</Text>
                      <Text style={styles.source}>{sourceLabel(tool.meta?.source)}</Text>
                    </View>
                    <Text style={styles.cardDescription} numberOfLines={3}>
                      {tool.definition.description || 'No description provided.'}
                    </Text>
                    {connected === false ? (
                      <Text style={styles.warning}>
                        Connect the account in Connections before agents can use this tool.
                      </Text>
                    ) : null}
                  </GlassView>
                );
              })
            )}
          </View>
        )}

        {filter === 'all' ? (
          <GlassView style={styles.card}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>MCP discovery</Text>
              <Text style={styles.sectionBadge}>{toolCount} tools</Text>
            </View>
            <Text style={styles.cardDescription}>
              Add servers in Connections. Each server is validated and its tools are registered
              through the existing MCP client.
            </Text>
            {mcpStatuses.length === 0 ? (
              <Text style={styles.emptyText}>No MCP servers configured yet.</Text>
            ) : (
              mcpStatuses.map((status) => (
                <View key={status.serverId} style={styles.mcpRow}>
                  <Ionicons
                    name={status.ok ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                    size={16}
                    color={status.ok ? colors.success : colors.danger}
                  />
                  <View style={styles.mcpCopy}>
                    <Text style={styles.mcpName}>{status.serverName}</Text>
                    <Text style={styles.cardMeta}>
                      {status.toolCount} tools
                      {status.error ? ` · ${status.error}` : ''}
                    </Text>
                  </View>
                </View>
              ))
            )}
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
      paddingHorizontal: spacing.lg,
      gap: spacing.md,
    },
    search: {
      minHeight: 50,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      color: colors.text,
      paddingHorizontal: spacing.md,
      fontSize: 15,
    },
    filters: {
      flexGrow: 0,
    },
    filter: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      marginRight: spacing.sm,
    },
    filterActive: {
      backgroundColor: colors.accentSoft,
    },
    filterText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    filterTextActive: {
      color: colors.accent,
    },
    section: {
      gap: spacing.sm,
    },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 19,
      fontWeight: '700',
    },
    sectionAction: {
      paddingVertical: spacing.xs,
    },
    sectionActionText: {
      color: colors.accent,
      fontSize: 13,
      fontWeight: '700',
    },
    sectionBadge: {
      color: colors.textFaint,
      fontSize: 12,
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
    loading: {
      paddingVertical: spacing.lg,
      alignItems: 'center',
    },
    emptyText: {
      color: colors.textFaint,
      fontSize: 13,
      lineHeight: 19,
    },
    card: {
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.md,
    },
    iconWrap: {
      width: 42,
      height: 42,
      borderRadius: radius.md,
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
      fontSize: 15,
      fontWeight: '700',
    },
    cardDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    cardMeta: {
      color: colors.textFaint,
      fontSize: 11,
    },
    cardActions: {
      flexDirection: 'row',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    toolTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    toolName: {
      flex: 1,
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    source: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    warning: {
      color: colors.warning,
      fontSize: 12,
      lineHeight: 17,
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
      fontSize: 13,
      fontWeight: '600',
    },
  });
