import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { getAppContext, type AppContextResult } from '@/lib/harness/spine/context';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FormError } from '@/components/FormError';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { useSidebar } from '@/context/sidebar';
import {
  loadHarnessSnapshot,
  refreshMcpTools,
  type HarnessPlugin,
  type HarnessPluginKind,
  type HarnessPluginState,
  type HarnessSnapshot,
} from '@/lib/harness';
import { radius, spacing, type AppColors } from '@/theme';


const KIND_ICONS: Record<HarnessPluginKind, keyof typeof Ionicons.glyphMap> = {
  provider: 'sparkles-outline',
  tool: 'construct-outline',
  storage: 'server-outline',
  mcp: 'extension-puzzle-outline',
};

type NativePluginRow = {
  name: string;
  icon: keyof typeof Ionicons.glyphMap;
  summary: string;
  color: string;
};

type NativePluginSection = {
  title: string;
  rows: NativePluginRow[];
};

function collectNativeSections(
  app: AppContextResult,
  colors: AppTheme['colors']
): NativePluginSection[] {
  return [
    {
      title: 'TOOLS (ctx.tools)',
      rows: app.ctx.tools.definitions().map((definition) => ({
        name: definition.name,
        icon: 'construct-outline' as keyof typeof Ionicons.glyphMap,
        summary: definition.description,
        color: colors.accentSoft,
      })),
    },
    {
      title: 'LLM (ctx.llm)',
      rows: app.ctx.llm.list().map((adapter) => ({
        name: adapter.label,
        icon: 'sparkles-outline' as keyof typeof Ionicons.glyphMap,
        summary: adapter.label,
        color: colors.success,
      })),
    },
    {
      title: 'MCP (ctx.mcp)',
      rows: app.ctx.mcp.statuses.map((status) => ({
        name: status.serverName,
        icon: 'extension-puzzle-outline' as keyof typeof Ionicons.glyphMap,
        summary: status.ok ? `${status.toolCount} tools` : (status.error ?? 'Not synced'),
        color: !status.ok ? colors.danger : status.toolCount > 0 ? colors.success : colors.textFaint,
      })),
    },
    {
      title: 'AGENT (ctx.agent)',
      rows: [
        {
          name: 'orbit-agent',
          icon: 'terminal-outline' as keyof typeof Ionicons.glyphMap,
          summary: 'Agent marker plugin',
          color: colors.accent,
        },
      ],
    },
  ];
}

function NativePluginRowItem({ row }: { row: NativePluginRow }) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.nativeRow}>
      <View style={[styles.pluginIcon, { backgroundColor: row.color }]}>
        <Ionicons name={row.icon} size={16} color={colors.white} />
      </View>

      <View style={styles.pluginText}>
        <View style={styles.pluginNameRow}>
          <Text numberOfLines={1} style={styles.pluginName}>
            {row.name}
          </Text>
          <Text style={[styles.pluginState, { color: row.color }]}>
            {row.icon.startsWith('terminal') ? 'READY' : 'ACTIVE'}
          </Text>
        </View>

        <Text numberOfLines={1} style={styles.pluginSummary}>
          {row.summary}
        </Text>
      </View>

      <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
    </View>
  );
}

function stateMeta(
  colors: AppColors
): Record<HarnessPluginState, { label: string; color: string; background: string }> {
  return {
    active: {
      label: 'ACTIVE',
      color: colors.success,
      background: colors.successSoft,
    },
    ready: {
      label: 'READY',
      color: colors.accent,
      background: colors.accentSoft,
    },
    configured: {
      label: 'SETUP',
      color: colors.textMuted,
      background: colors.surfaceAlt,
    },
    disabled: {
      label: 'OFF',
      color: colors.textFaint,
      background: colors.surfaceAlt,
    },
    error: {
      label: 'ERROR',
      color: colors.danger,
      background: colors.dangerSoft,
    },
  };
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);

  return `${date.getHours().toString().padStart(2, '0')}:${date
    .getMinutes()
    .toString()
    .padStart(2, '0')}`;
}

function PluginRow({
  plugin,
  first,
  onPress,
}: {
  plugin: HarnessPlugin;
  first: boolean;
  onPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const meta = stateMeta(colors)[plugin.state];

  const body = (
    <View style={[styles.pluginRow, !first && styles.pluginRowBorder]}>
      <View style={[styles.pluginIcon, { backgroundColor: meta.background }]}>
        <Ionicons name={KIND_ICONS[plugin.kind]} size={16} color={meta.color} />
      </View>

      <View style={styles.pluginText}>
        <View style={styles.pluginNameRow}>
          <Text numberOfLines={1} style={styles.pluginName}>
            {plugin.name}
          </Text>
          <Text style={[styles.pluginState, { color: meta.color }]}>
            {meta.label}
          </Text>
        </View>

        <Text numberOfLines={2} style={styles.pluginSummary}>
          {plugin.summary}
        </Text>

        {plugin.detail ? (
          <Text
            numberOfLines={2}
            style={[styles.pluginDetail, { color: meta.color }]}
          >
            {plugin.detail}
          </Text>
        ) : null}
      </View>

      {onPress ? (
        <Ionicons name="chevron-forward" size={15} color={colors.textFaint} />
      ) : null}
    </View>
  );

  if (!onPress) {
    return body;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open settings for ${plugin.name}`}
      onPress={onPress}
      style={({ pressed }) => [pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function SectionTitle({ label, count }: { label: string; count: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.sectionCount}>{count}</Text>
    </View>
  );
}

export default function HarnessScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { open: openSidebar } = useSidebar();
  const [snapshot, setSnapshot] = useState<HarnessSnapshot | null>(null);
  const [nativeSections, setNativeSections] = useState<NativePluginSection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);

  const load = useCallback(async () => {
    try {
      setSnapshot(await loadHarnessSnapshot());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load the harness.'
      );
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();

      const app = getAppContext();
      setNativeSections(app ? collectNativeSections(app, colors) : []);
    }, [colors, load])
  );

  async function syncMcp() {
    if (isSyncing) {
      return;
    }

    if ((snapshot?.counts.mcpServers ?? 0) === 0) {
      setNotice(null);
      setError('No MCP server is configured. Add one in Settings → MCP TOOLS.');
      return;
    }

    setIsSyncing(true);
    setError(null);
    setNotice(null);

    try {
      const result = await refreshMcpTools();
      await load();

      const failed = result.statuses.find((status) => !status.ok);

      if (failed) {
        setError(`${failed.serverName}: ${failed.error ?? 'could not connect.'}`);
      } else {
        setNotice(`MCP synced · ${result.toolCount} tools available.`);
      }
    } catch (syncError) {
      setError(
        syncError instanceof Error ? syncError.message : 'MCP sync failed.'
      );
    } finally {
      setIsSyncing(false);
    }
  }

  const providers =
    snapshot?.plugins.filter((plugin) => plugin.kind === 'provider') ?? [];
  const tools =
    snapshot?.plugins.filter((plugin) => plugin.kind === 'tool') ?? [];
  const storages =
    snapshot?.plugins.filter((plugin) => plugin.kind === 'storage') ?? [];
  const mcpServers =
    snapshot?.plugins.filter((plugin) => plugin.kind === 'mcp') ?? [];

  return (
    <View style={styles.root}>
      <GlassBackdrop />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="ORBIT HARNESS"
          title="Plugins"
          subtitle="Providers, tools, storage and MCP — all from one registry."
          left={<SidebarButton onPress={openSidebar} />}
        />

        {error ? (
          <View style={styles.banner}>
            <FormError message={error} />
          </View>
        ) : null}

        {notice ? (
          <View style={styles.notice}>
            <Ionicons name="checkmark-circle" size={15} color={colors.success} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        <GlassView style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroIcon}>
              <Ionicons name="git-network" size={20} color={colors.accent} />
            </View>

            <View style={styles.heroText}>
              <Text style={styles.heroTitle}>Everything is a plugin.</Text>
              <Text style={styles.heroSubtitle}>
                MCP is just another source. Har capability same lifecycle follow
                karti hai.
              </Text>
            </View>
          </View>

          <View style={styles.heroBadgeRow}>
            <View
              style={[
                styles.modeChip,
                snapshot?.aiReady ? styles.modeOn : styles.modeOff,
              ]}
            >
              <Text
                style={[
                  styles.modeText,
                  { color: snapshot?.aiReady ? colors.success : colors.textMuted },
                ]}
              >
                {snapshot?.aiReady ? 'AI READY' : 'LOCAL MODE'}
              </Text>
            </View>

            <Text numberOfLines={1} style={styles.heroMeta}>
              {snapshot
                ? snapshot.aiReady
                  ? `${snapshot.activeProvider} · ${snapshot.activeAdapter}`
                  : 'Koi cloud provider configured nahi'
                : 'Loading…'}
            </Text>
          </View>

          <View style={styles.statsRow}>
            <Stat value={snapshot?.counts.providers ?? 0} label="Providers" />
            <Stat value={snapshot?.counts.tools ?? 0} label="Tools" />
            <Stat value={snapshot?.counts.storages ?? 0} label="Stores" />
            <Stat value={snapshot?.counts.mcpServers ?? 0} label="MCP" />
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sync MCP tools"
              disabled={isSyncing || !snapshot}
              onPress={() => {
                void syncMcp();
              }}
              style={({ pressed }) => [
                styles.actionButton,
                (isSyncing || !snapshot) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              {isSyncing ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Ionicons name="sync" size={15} color={colors.accent} />
              )}
              <Text style={styles.actionText}>
                {isSyncing ? 'Syncing…' : 'Sync MCP'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open settings"
              onPress={() => router.push('/settings')}
              style={({ pressed }) => [
                styles.secondaryButton,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="settings-outline" size={15} color={colors.textMuted} />
              <Text style={styles.secondaryText}>Settings</Text>
            </Pressable>
          </View>
        </GlassView>

        {!snapshot ? (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : (
          <>
            <SectionTitle label="AI PROVIDERS" count={`${providers.length}`} />

            <GlassView style={styles.card}>
              {providers.map((plugin, index) => (
                <PluginRow
                  key={plugin.id}
                  plugin={plugin}
                  first={index === 0}
                  onPress={() => router.push('/settings')}
                />
              ))}
            </GlassView>

            <SectionTitle label="TOOLS" count={`${tools.length} built-in`} />

            <GlassView style={styles.card}>
              {tools.map((plugin, index) => (
                <PluginRow key={plugin.id} plugin={plugin} first={index === 0} />
              ))}
            </GlassView>

            <SectionTitle label="STORAGE" count={`${storages.length}`} />

            <GlassView style={styles.card}>
              {storages.map((plugin, index) => (
                <PluginRow key={plugin.id} plugin={plugin} first={index === 0} />
              ))}
            </GlassView>

            <SectionTitle
              label="MCP SERVERS"
              count={
                snapshot.counts.mcpServers === 0
                  ? 'none'
                  : `${snapshot.counts.mcpServers} · ${snapshot.counts.mcpTools} tools`
              }
            />

            <GlassView style={styles.card}>
              {mcpServers.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons
                    name="extension-puzzle-outline"
                    size={22}
                    color={colors.textFaint}
                  />
                  <Text style={styles.emptyTitle}>No MCP servers</Text>
                  <Text style={styles.emptyText}>
                    Add an endpoint in Settings → MCP TOOLS. Tools become available to the agent automatically.
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => router.push('/settings')}
                    style={({ pressed }) => [
                      styles.emptyButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={styles.emptyButtonText}>Add server</Text>
                    <Ionicons name="arrow-forward" size={14} color={colors.accent} />
                  </Pressable>
                </View>
              ) : (
                mcpServers.map((plugin, index) => (
                  <PluginRow
                    key={plugin.id}
                    plugin={plugin}
                    first={index === 0}
                    onPress={() => router.push('/settings')}
                  />
                ))
              )}
            </GlassView>

            {nativeSections.map((section) => (
              <View key={section.title} style={styles.nativeSection}>
                <SectionTitle label={section.title} count={String(section.rows.length)} />

                <GlassView style={styles.card}>
                  {section.rows.map((row) => (
                    <NativePluginRowItem key={row.name} row={row} />
                  ))}
                  {section.rows.length === 0 ? (
                    <View style={styles.empty}>
                      <Ionicons name="terminal-outline" size={22} color={colors.textFaint} />
                      <Text style={styles.emptyTitle}>
                        {section.title === 'MCP (ctx.mcp)'
                          ? 'Koi MCP server connected nahi'
                          : 'Koi plugins nahi'}
                      </Text>
                      <Text style={styles.emptyText}>
                        Add a server in Settings → MCP TOOLS, or tap Sync MCP.
                      </Text>
                    </View>
                  ) : null}
                </GlassView>
              </View>
            ))}

            <Text style={styles.footer}>
              {snapshot.plugins.length} plugins · snapshot {formatTime(snapshot.checkedAt)}
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
  },
  banner: {
    marginTop: spacing.lg,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: `${colors.success}47`,
    borderTopColor: glass.borderBright,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  noticeText: {
    flex: 1,
    color: colors.success,
    fontSize: 13,
    lineHeight: 19,
  },
  hero: {
    borderColor: colors.border,
    padding: spacing.md + 2,
    marginTop: spacing.lg,
    gap: spacing.md,
  },
  heroTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  heroIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroText: {
    flex: 1,
    gap: 3,
  },
  heroTitle: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  heroSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
  },
  heroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  modeChip: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  modeOn: {
    backgroundColor: colors.successSoft,
  },
  modeOff: {
    backgroundColor: colors.surfaceAlt,
  },
  modeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  heroMeta: {
    flex: 1,
    color: colors.textFaint,
    fontSize: 11,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: glass.fillSoft,
    borderWidth: 1,
    borderColor: glass.border,
    borderTopColor: glass.borderBright,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    gap: 1,
  },
  statValue: {
    color: colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  statLabel: {
    color: colors.textFaint,
    fontSize: 9,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderFocus,
    backgroundColor: colors.accentSoft,
    borderTopColor: glass.borderBright,
  },
  actionText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  secondaryButton: {
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
  secondaryText: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
  disabled: {
    opacity: 0.55,
  },
  pressed: {
    opacity: 0.78,
  },
  loading: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
  },
  sectionCount: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '600',
  },
  card: {
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  pluginRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  nativeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
  },
  nativeSection: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  pluginRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  pluginIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pluginText: {
    flex: 1,
    gap: 2,
  },
  pluginNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pluginName: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  pluginState: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
  },
  pluginSummary: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  pluginDetail: {
    fontSize: 11,
    lineHeight: 16,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    gap: spacing.xs,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 2,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  emptyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
    paddingVertical: 8,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: colors.border,
  },
  emptyButtonText: {
    color: colors.accent,
    fontSize: 12,
    fontWeight: '600',
  },
  footer: {
    color: colors.textFaint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  });
