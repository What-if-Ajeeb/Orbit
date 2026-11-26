import Ionicons from '@expo/vector-icons/Ionicons';
import { setStringAsync as copyToClipboard } from 'expo-clipboard';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SettingsSection } from '@/components/SettingsSection';
import { SidebarButton } from '@/components/SidebarButton';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
import { usePluginPlatform, usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { useBuilderDrafts } from '@/components/plugins/useBuilderDrafts';
import { useBuilderLogs } from '@/components/plugins/useBuilderLogs';
import {
  disableBuilderPlugin,
  enableBuilderPlugin,
  exportBuilderManifest,
  prepareBuilderDraftForPublish,
  uninstallBuilderPlugin,
} from '@/lib/plugins/builder-service';
import { validateAndBuild, type BuilderDraft } from '@/lib/plugins/builder';
import type { PluginSummary } from '@/lib/plugins/types';
import { formatRelative } from '@/lib/dates';
import { layout, radius, spacing, typography } from '@/theme';

const INSTALLED_STATUSES = new Set([
  'installed',
  'disabled',
  'enabling',
  'enabled',
  'starting',
  'running',
  'stopping',
  'error',
  'updating',
]);

function draftStatus(draft: BuilderDraft, summary?: PluginSummary | null) {
  if (!summary || !INSTALLED_STATUSES.has(summary.status)) {
    return { label: 'Draft', tone: 'warning' as StatusTone };
  }

  if (summary.status === 'running' || summary.status === 'enabled') {
    return { label: 'Installed · On', tone: 'success' as StatusTone };
  }

  if (summary.status === 'disabled') {
    return { label: 'Installed · Off', tone: 'neutral' as StatusTone };
  }

  if (summary.status === 'error') {
    return { label: 'Error', tone: 'danger' as StatusTone };
  }

  return { label: 'Installed', tone: 'info' as StatusTone };
}

export default function MyPluginsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { open: openSidebar } = useSidebar();
  const snapshot = usePluginSnapshot();
  const platform = usePluginPlatform();
  const drafts = useBuilderDrafts();
  const logs = useBuilderLogs('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const summaries = useMemo(() => {
    const map = new Map<string, PluginSummary>();
    for (const summary of snapshot.summaries) {
      map.set(summary.manifest.pluginId, summary);
    }
    return map;
  }, [snapshot.summaries]);

  const localInstalled = useMemo(
    () =>
      snapshot.summaries.filter(
        (summary) =>
          summary.trustLevel === 'local' &&
          INSTALLED_STATUSES.has(summary.status) &&
          !drafts.drafts.some((draft) => draft.pluginId === summary.manifest.pluginId)
      ),
    [snapshot.summaries, drafts.drafts]
  );

  function openBuilder(pluginId?: string) {
    router.push(
      (pluginId
        ? `/plugins/builder?pluginId=${encodeURIComponent(pluginId)}`
        : '/plugins/builder') as Href
    );
  }

  function openDetail(pluginId: string) {
    router.navigate(`/plugins/${encodeURIComponent(pluginId)}` as Href);
  }

  function showError(message: string) {
    setError(message);
  }

  async function run(id: string, label: string, task: () => Promise<void>) {
    if (busyId) return;
    setBusyId(id);
    setError(null);
    setNotice(null);
    try {
      await task();
    } catch (taskError) {
      showError(
        taskError instanceof Error ? taskError.message : `${label} failed.`
      );
    } finally {
      setBusyId(null);
    }
  }

  function confirmDelete(draft: BuilderDraft) {
    Alert.alert(
      'Delete draft?',
      `“${draft.name || draft.pluginId}” will be removed from this device. Installed copies are not affected.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void run(draft.pluginId, 'Delete', async () => {
              await drafts.remove(draft.pluginId);
              setNotice('Draft deleted.');
            });
          },
        },
      ]
    );
  }

  function confirmUninstall(pluginId: string, name: string) {
    Alert.alert(
      'Uninstall plugin?',
      `“${name}” will be disabled and removed from this device. Its draft is kept.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Uninstall',
          style: 'destructive',
          onPress: () => {
            void run(pluginId, 'Uninstall', async () => {
              const result = await uninstallBuilderPlugin(
                platform,
                pluginId
              );
              if (!result.ok) throw new Error(result.errors[0] ?? 'Uninstall failed.');
              setNotice('Plugin uninstalled.');
            });
          },
        },
      ]
    );
  }

  function showDraftActions(draft: BuilderDraft) {
    const summary = summaries.get(draft.pluginId) ?? null;
    const installed = Boolean(summary && INSTALLED_STATUSES.has(summary.status));
    const enabled = summary?.status === 'running' || summary?.status === 'enabled';

    const options: { label: string; onPress: () => void }[] = [
      { label: 'Edit draft', onPress: () => openBuilder(draft.pluginId) },
      {
        label: 'Duplicate draft',
        onPress: () => {
          void run(draft.pluginId, 'Duplicate', async () => {
            const base = `${draft.pluginId}-copy`;
            let newId = base;
            let suffix = 2;
            const ids = new Set(drafts.drafts.map((entry) => entry.pluginId));

            while (ids.has(newId)) {
              newId = `${base}-${suffix}`;
              suffix += 1;
            }

            await drafts.duplicate(draft.pluginId, newId, `${draft.name || draft.pluginId} copy`);
            setNotice('Draft duplicated.');
          });
        },
      },
      {
        label: 'Export manifest',
        onPress: () => {
          void run(draft.pluginId, 'Export', async () => {
            const json = exportBuilderManifest(draft);
            await copyToClipboard(json);
            setNotice('Canonical manifest copied to clipboard.');
          });
        },
      },
      {
        label: 'Prepare for publishing',
        onPress: () => {
          void run(draft.pluginId, 'Prepare', async () => {
            const prepared = prepareBuilderDraftForPublish(draft);
            await drafts.save(prepared);
            setNotice(
              'Marked ready for review. Publishing is a separate, reviewed step.'
            );
          });
        },
      },
      {
        label: 'Execution history & logs',
        onPress: () => openDetail(draft.pluginId),
      },
    ];

    if (installed) {
      options.push(
        enabled
          ? {
              label: 'Disable plugin',
              onPress: () => {
                void run(draft.pluginId, 'Disable', async () => {
                  const result = await disableBuilderPlugin(
                    platform,
                    draft.pluginId
                  );
                  if (!result.ok) throw new Error(result.errors[0] ?? 'Disable failed.');
                  setNotice('Plugin disabled.');
                });
              },
            }
          : {
              label: 'Enable plugin',
              onPress: () => {
                void run(draft.pluginId, 'Enable', async () => {
                  const result = await enableBuilderPlugin(
                    platform,
                    draft.pluginId
                  );
                  if (!result.ok) throw new Error(result.errors[0] ?? 'Enable failed.');
                  setNotice('Plugin enabled.');
                });
              },
            }
      );
      options.push({
        label: 'Uninstall plugin',
        onPress: () => confirmUninstall(draft.pluginId, draft.name),
      });
    }

    options.push({
      label: 'Delete draft',
      onPress: () => confirmDelete(draft),
    });

    Alert.alert(
      draft.name || draft.pluginId,
      'Choose an action.',
      [
        ...options.map((option) => ({
          text: option.label,
          onPress: option.onPress,
        })),
        { text: 'Cancel', style: 'cancel' as const },
      ],
      { cancelable: true }
    );
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
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <SidebarButton onPress={openSidebar} />
          <ScreenHeader
            title="My Plugins"
            subtitle="Locally built plugins, drafts and their lifecycle."
          />
        </View>

        <View style={styles.ctaRow}>
          <Button
            label="Create Plugin"
            onPress={() => openBuilder()}
            style={styles.ctaButton}
          />
          <Button
            label="Installed plugins"
            variant="secondary"
            onPress={() => router.navigate('/plugins' as Href)}
            style={styles.ctaButton}
          />
        </View>

        {error ? (
          <View style={[styles.banner, styles.bannerError]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.bannerErrorText}>{error}</Text>
          </View>
        ) : null}
        {notice ? (
          <View style={[styles.banner, styles.bannerNotice]}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
            <Text style={styles.bannerNoticeText}>{notice}</Text>
          </View>
        ) : null}

        <BuilderInfoNote />

        <SettingsSection
          title="Drafts"
          description="Builder drafts are saved on this device and never run installed code."
          action={
            <Text style={styles.count}>
              {drafts.drafts.length} draft{drafts.drafts.length === 1 ? '' : 's'}
            </Text>
          }
        >
          {drafts.loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.loadingText}>Loading drafts…</Text>
            </View>
          ) : drafts.drafts.length === 0 ? (
            <EmptyState
              icon="hammer-outline"
              title="No drafts yet"
              message="Create a plugin to start a new draft. Drafts stay editable until you install them."
              actionLabel="Create Plugin"
              onAction={() => openBuilder()}
            />
          ) : (
            <View style={styles.list}>
              {drafts.drafts.map((draft) => {
                const summary = summaries.get(draft.pluginId) ?? null;
                const status = draftStatus(draft, summary);
                const validation = validateAndBuild(draft);
                const busy = busyId === draft.pluginId;

                return (
                  <GlassView key={draft.pluginId} style={styles.card}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Edit ${draft.name || draft.pluginId}`}
                      onPress={() => openBuilder(draft.pluginId)}
                      style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
                    >
                      <View style={styles.iconWrap}>
                        <Ionicons
                          name="hammer-outline"
                          size={21}
                          color={colors.accent}
                        />
                      </View>
                      <View style={styles.cardText}>
                        <View style={styles.titleRow}>
                          <Text numberOfLines={1} style={styles.name}>
                            {draft.name || draft.pluginId}
                          </Text>
                          <StatusPill label={status.label} tone={status.tone} />
                        </View>
                        <Text numberOfLines={2} style={styles.description}>
                          {draft.description || 'No description yet.'}
                        </Text>
                        <Text numberOfLines={1} style={styles.meta}>
                          v{draft.version} · {draft.actions.length} action
                          {draft.actions.length === 1 ? '' : 's'} · updated{' '}
                          {formatRelative(draft.updatedAt)}
                        </Text>
                        <View style={styles.validationRow}>
                          <Ionicons
                            name={validation.ok ? 'checkmark-circle-outline' : 'alert-circle-outline'}
                            size={13}
                            color={validation.ok ? colors.success : colors.danger}
                          />
                          <Text
                            style={[
                              styles.validationText,
                              { color: validation.ok ? colors.success : colors.danger },
                            ]}
                          >
                            {validation.ok
                              ? 'Ready to install'
                              : `${validation.errors.length} issue${validation.errors.length === 1 ? '' : 's'} to fix`}
                          </Text>
                          {draft.preparedForPublish ? (
                            <Text style={styles.reviewTag}>Review ready</Text>
                          ) : null}
                        </View>
                      </View>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Actions for ${draft.name || draft.pluginId}`}
                      disabled={busy}
                      onPress={() => showDraftActions(draft)}
                      style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color={colors.accent} />
                      ) : (
                        <Ionicons name="ellipsis-vertical" size={18} color={colors.textMuted} />
                      )}
                    </Pressable>
                  </GlassView>
                );
              })}
            </View>
          )}
        </SettingsSection>

        <SettingsSection
          title="Installed local plugins"
          description="Built on this device. Permissions stay default-deny until you enable them."
        >
          {localInstalled.length === 0 ? (
            <Text style={styles.emptyHint}>
              No installed local plugins without a draft. Build and install a draft to see it here.
            </Text>
          ) : (
            <View style={styles.list}>
              {localInstalled.map((summary) => (
                <GlassView key={summary.manifest.pluginId} style={styles.card}>
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => openDetail(summary.manifest.pluginId)}
                    style={({ pressed }) => [styles.cardMain, pressed && styles.pressed]}
                  >
                    <View style={styles.iconWrap}>
                      <Ionicons
                        name="extension-puzzle-outline"
                        size={21}
                        color={colors.accent}
                      />
                    </View>
                    <View style={styles.cardText}>
                      <Text numberOfLines={1} style={styles.name}>
                        {summary.manifest.name}
                      </Text>
                      <Text numberOfLines={2} style={styles.description}>
                        {summary.manifest.description}
                      </Text>
                      <Text style={styles.meta}>
                        v{summary.manifest.version} · local
                      </Text>
                    </View>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Actions for ${summary.manifest.name}`}
                    onPress={() => openDetail(summary.manifest.pluginId)}
                    style={({ pressed }) => [styles.moreButton, pressed && styles.pressed]}
                  >
                    <Ionicons name="ellipsis-vertical" size={18} color={colors.textMuted} />
                  </Pressable>
                </GlassView>
              ))}
            </View>
          )}
        </SettingsSection>

        <SettingsSection
          title="Builder activity"
          description="Recent install, enable, test and error events. Values are redacted."
          action={
            logs.logs.length > 0 ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Clear builder activity"
                onPress={() => {
                  void logs.clear();
                }}
                style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
              >
                <Text style={styles.clearText}>Clear</Text>
              </Pressable>
            ) : null
          }
        >
          {logs.loading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.accent} />
              <Text style={styles.loadingText}>Loading activity…</Text>
            </View>
          ) : logs.logs.length === 0 ? (
            <Text style={styles.emptyHint}>No builder activity yet.</Text>
          ) : (
            <View style={styles.list}>
              {logs.logs.slice(0, 20).map((entry) => (
                <View key={entry.id} style={styles.logRow}>
                  <Ionicons
                    name={entry.level === 'error' ? 'alert-circle-outline' : 'information-circle-outline'}
                    size={14}
                    color={entry.level === 'error' ? colors.danger : colors.accent}
                  />
                  <Text style={styles.logText} numberOfLines={2}>
                    {entry.message}
                  </Text>
                  <Text style={styles.logTime}>{formatRelative(entry.at)}</Text>
                </View>
              ))}
            </View>
          )}
        </SettingsSection>
      </ScrollView>
    </View>
  );
}

function BuilderInfoNote() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={[styles.info, { borderColor: colors.border }]}>
      <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
      <Text style={styles.infoText}>
        Builder plugins compile to fixed, data-only sandbox programs. No JavaScript is
        executed in the app, and every run asks for fresh approval.
      </Text>
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
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    ctaRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    ctaButton: {
      flex: 1,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      padding: spacing.sm,
    },
    bannerError: {
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
    },
    bannerErrorText: {
      flex: 1,
      color: colors.danger,
      ...typography.bodySmall,
    },
    bannerNotice: {
      borderColor: colors.success,
      backgroundColor: colors.successSoft,
    },
    bannerNoticeText: {
      flex: 1,
      color: colors.success,
      ...typography.bodySmall,
    },
    info: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderWidth: 1,
      borderRadius: radius.md,
      padding: spacing.sm,
    },
    infoText: {
      flex: 1,
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    count: {
      color: colors.textFaint,
      ...typography.caption,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
    },
    loadingText: {
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    emptyHint: {
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    list: {
      gap: spacing.sm,
    },
    card: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.lg,
      padding: spacing.sm + 2,
    },
    cardMain: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    cardText: {
      flex: 1,
      gap: 3,
    },
    iconWrap: {
      width: 40,
      height: 40,
      borderRadius: 12,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    name: {
      flexShrink: 1,
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    description: {
      color: colors.textMuted,
      ...typography.caption,
    },
    meta: {
      color: colors.textFaint,
      ...typography.caption,
    },
    validationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    validationText: {
      ...typography.caption,
    },
    reviewTag: {
      marginLeft: 'auto',
      color: colors.accent,
      ...typography.caption,
      fontWeight: '600',
    },
    moreButton: {
      minWidth: layout.iconButton,
      minHeight: layout.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    clearButton: {
      minHeight: 32,
      justifyContent: 'center',
      paddingHorizontal: spacing.sm,
    },
    clearText: {
      color: colors.accent,
      ...typography.caption,
      fontWeight: '600',
    },
    logRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.xs + 2,
      paddingVertical: 4,
    },
    logText: {
      flex: 1,
      color: colors.textMuted,
      ...typography.caption,
    },
    logTime: {
      color: colors.textFaint,
      ...typography.caption,
      fontSize: 11,
    },
    pressed: {
      opacity: 0.78,
    },
  });
