import Ionicons from '@expo/vector-icons/Ionicons';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { PluginSettingsForm } from '@/components/plugins/PluginSettingsForm';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { usePluginPlatform, usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { DIAGNOSTICS_PLUGIN_ID } from '@/lib/plugins/builtins';
import { PLUGIN_PERMISSION_META } from '@/lib/plugins/permissions';
import type { PluginNavigationContribution } from '@/lib/plugins/platform';
import { radius, spacing } from '@/theme';

export default function PluginHomeScreen() {
  const params = useLocalSearchParams<{ pluginId?: string; screen?: string }>();
  const pluginId = params.pluginId ? decodeURIComponent(params.pluginId) : '';
  const screenId = params.screen ? decodeURIComponent(params.screen) : undefined;
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { open: openSidebar } = useSidebar();
  const snapshot = usePluginSnapshot();
  const platform = usePluginPlatform();

  const summary = snapshot.summaries.find(
    (candidate) => candidate.manifest.pluginId === pluginId
  );

  if (!summary || !platform) {
    return (
      <View style={styles.root}>
        <GlassBackdrop />
        <View style={[styles.content, { paddingTop: insets.top + spacing.md }]}>
          <ScreenHeader title="Plugin unavailable" subtitle={pluginId} />
          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate('/plugins' as Href)}
            style={styles.backLink}
          >
            <Ionicons name="chevron-back" size={16} color={colors.accent} />
            <Text style={styles.backLinkText}>Back to plugins</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const manifest = summary.manifest;
  const route = screenId
    ? manifest.routes.find((candidate) => candidate.id === screenId)
    : manifest.routes[0];
  const navEntry: PluginNavigationContribution | undefined =
    snapshot.navigation.find((entry) => entry.pluginId === pluginId);

  function emitAction(actionId: string, event: string) {
    platform?.events.emit(
      'plugin.action',
      { pluginId, actionId, event },
      'plugin-ui'
    );
  }

  const interactiveActions =
    manifest.entryPoint.kind === 'builtin' &&
    manifest.events.listens.includes('plugin.action')
      ? [
          ...manifest.toolbarActions,
          ...manifest.contextActions.filter(
            (action) => action.context === 'plugin-home'
          ),
        ]
      : [];

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
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <SidebarButton onPress={openSidebar} />
          <ScreenHeader
            title={route?.title ?? manifest.name}
            subtitle={navEntry?.label ?? manifest.description}
          />
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.navigate('/plugins' as Href)}
          style={styles.backLink}
        >
          <Ionicons name="chevron-back" size={16} color={colors.accent} />
          <Text style={styles.backLinkText}>All plugins</Text>
        </Pressable>

        {summary.status !== 'running' ? (
          <GlassView style={styles.card}>
            <View style={styles.disabledRow}>
              <Ionicons name="pause-circle-outline" size={22} color={colors.warning} />
              <View style={styles.disabledText}>
                <Text style={styles.cardTitle}>This plugin is not running</Text>
                <Text style={styles.muted}>
                  Enable it in the Plugin Manager to use its contributions. Nothing
                  from a disabled plugin is rendered.
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                router.navigate(
                  `/plugins/${encodeURIComponent(pluginId)}` as Href
                )
              }
              style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
            >
              <Text style={styles.primaryButtonText}>Manage plugin</Text>
            </Pressable>
          </GlassView>
        ) : null}

        {summary.status === 'running' && pluginId === DIAGNOSTICS_PLUGIN_ID ? (
          <DiagnosticsPanel />
        ) : null}

        {summary.status === 'running' && pluginId !== DIAGNOSTICS_PLUGIN_ID ? (
          <GlassView style={styles.card}>
            <View style={styles.cardHeading}>
              <View style={styles.cardIcon}>
                <Ionicons
                  name="layers-outline"
                  size={20}
                  color={colors.accent}
                />
              </View>
              <View style={styles.cardHeadingText}>
                <Text style={styles.cardTitle}>
                  {route?.title ?? manifest.name}
                </Text>
                <Text style={styles.muted}>
                  Screen “{route?.id ?? 'home'}” is rendered by ORBIT from this
                  plugin&apos;s manifest.
                </Text>
              </View>
            </View>

            <Text style={styles.body}>
              {manifest.description}
            </Text>

            {interactiveActions.length > 0 ? (
              <View style={styles.actionRow}>
                {interactiveActions.map((action) => (
                  <Pressable
                    key={action.id}
                    accessibilityRole="button"
                    onPress={() => emitAction(action.id, action.event)}
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      pressed && styles.pressed,
                    ]}
                  >
                    <Ionicons
                      name={
                        action.icon in Ionicons.glyphMap
                          ? (action.icon as keyof typeof Ionicons.glyphMap)
                          : 'flash-outline'
                      }
                      size={15}
                      color={colors.accent}
                    />
                    <Text style={styles.secondaryButtonText}>{action.label}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </GlassView>
        ) : null}

        {manifest.dashboardWidgets.length > 0 && summary.status === 'running' ? (
          <View style={styles.widgetGrid}>
            {manifest.dashboardWidgets.map((widget) => (
              <GlassView key={widget.id} style={styles.widget}>
                <Text style={styles.widgetTitle}>{widget.title}</Text>
                <Text style={styles.widgetBody}>{widget.description}</Text>
                <Text style={styles.widgetMeta}>
                  {manifest.name} · {widget.size ?? 'small'}
                </Text>
              </GlassView>
            ))}
          </View>
        ) : null}

        <GlassView style={styles.card}>
          <Text style={styles.cardTitle}>Plugin settings</Text>
          <PluginSettingsForm
            platform={platform}
            pluginId={pluginId}
            fields={manifest.settingsSchema}
          />
        </GlassView>

        <GlassView style={styles.card}>
          <Text style={styles.cardTitle}>Declared permissions</Text>
          {manifest.permissions.length === 0 ? (
            <Text style={styles.muted}>No permissions requested.</Text>
          ) : (
            <View style={styles.permissionList}>
              {manifest.permissions.map((permission) => {
                const granted = platform.permissions.has(pluginId, permission);

                return (
                  <View key={permission} style={styles.permissionRow}>
                    <Ionicons
                      name={granted ? 'checkmark-circle' : 'close-circle'}
                      size={14}
                      color={granted ? colors.success : colors.textFaint}
                    />
                    <Text style={styles.permissionText}>
                      {PLUGIN_PERMISSION_META[permission].label}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </GlassView>

        <View style={styles.footerRow}>
          <Text style={styles.footerText}>
            v{manifest.version} · {summary.trustLevel}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              router.navigate(
                `/plugins/${encodeURIComponent(pluginId)}` as Href
              )
            }
            style={({ pressed }) => [styles.footerLink, pressed && styles.pressed]}
          >
            <Ionicons name="settings-outline" size={14} color={colors.accent} />
            <Text style={styles.footerLinkText}>Plugin details</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function DiagnosticsPanel() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const snapshot = usePluginSnapshot();
  const platform = usePluginPlatform();

  if (!platform) {
    return null;
  }

  return (
    <GlassView style={styles.card}>
      <View style={styles.cardHeading}>
        <View style={styles.cardIcon}>
          <Ionicons name="pulse-outline" size={20} color={colors.accent} />
        </View>
        <View style={styles.cardHeadingText}>
          <Text style={styles.cardTitle}>Plugin platform health</Text>
          <Text style={styles.muted}>
            Live state from the unified registry. No plugin code runs in this panel.
          </Text>
        </View>
      </View>

      <View style={styles.statGrid}>
        <DiagnosticStat label="Installed" value={snapshot.stats.installed} />
        <DiagnosticStat label="Running" value={snapshot.stats.running} />
        <DiagnosticStat label="Errors" value={snapshot.stats.errors} />
        <DiagnosticStat label="Updates" value={snapshot.stats.updates} />
      </View>

      <View style={styles.diagList}>
        {snapshot.summaries
          .filter((summary) => summary.status !== 'available')
          .map((summary) => (
            <View
              key={summary.manifest.pluginId}
              style={styles.diagRow}
            >
              <View
                style={[
                  styles.diagDot,
                  {
                    backgroundColor:
                      summary.status === 'running'
                        ? colors.success
                        : summary.status === 'error'
                          ? colors.danger
                          : colors.textFaint,
                  },
                ]}
              />
              <Text numberOfLines={1} style={styles.diagName}>
                {summary.manifest.name}
              </Text>
              <Text style={styles.diagState}>{summary.status}</Text>
            </View>
          ))}
      </View>

      <Text style={styles.muted}>
        Bootstrap:{' '}
        {snapshot.stats.bootstrapMs !== null
          ? `${snapshot.stats.bootstrapMs} ms`
          : 'not finished'}{' '}
        · Audit log lives in each plugin&apos;s detail screen.
      </Text>
    </GlassView>
  );
}

function DiagnosticStat({ label, value }: { label: string; value: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
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
      paddingHorizontal: spacing.md,
      gap: spacing.md,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    backLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      alignSelf: 'flex-start',
    },
    backLinkText: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: '600',
    },
    card: {
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    cardIcon: {
      width: 42,
      height: 42,
      borderRadius: 14,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardHeadingText: {
      flex: 1,
      gap: 2,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    muted: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
    },
    body: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 19,
    },
    actionRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    secondaryButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
    },
    secondaryButtonText: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '700',
    },
    primaryButton: {
      alignSelf: 'flex-start',
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
      paddingHorizontal: spacing.md,
      paddingVertical: 9,
    },
    primaryButtonText: {
      color: colors.onInverse,
      fontSize: 12,
      fontWeight: '700',
    },
    disabledRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    disabledText: {
      flex: 1,
      gap: 2,
    },
    widgetGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
    },
    widget: {
      flexGrow: 1,
      flexBasis: '45%',
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: 3,
    },
    widgetTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    widgetBody: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
    },
    widgetMeta: {
      color: colors.textFaint,
      fontSize: 9,
      marginTop: 2,
    },
    permissionList: {
      gap: spacing.xs,
    },
    permissionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    permissionText: {
      color: colors.textMuted,
      fontSize: 12,
    },
    footerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    footerText: {
      color: colors.textFaint,
      fontSize: 10,
    },
    footerLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    footerLinkText: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '600',
    },
    statGrid: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    stat: {
      flex: 1,
      alignItems: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.fillSoft,
      paddingVertical: spacing.sm,
    },
    statValue: {
      color: colors.text,
      fontSize: 19,
      fontWeight: '700',
    },
    statLabel: {
      color: colors.textMuted,
      fontSize: 9,
      fontWeight: '600',
    },
    diagList: {
      gap: spacing.xs,
    },
    diagRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    diagDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    diagName: {
      flex: 1,
      color: colors.text,
      fontSize: 11,
    },
    diagState: {
      color: colors.textFaint,
      fontSize: 10,
    },
    pressed: {
      opacity: 0.78,
    },
  });
