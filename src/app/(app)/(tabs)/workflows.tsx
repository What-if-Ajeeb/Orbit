import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { EmptyState } from '@/components/EmptyState';
import { FormError } from '@/components/FormError';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { Skeleton } from '@/components/Skeleton';
import { TextField } from '@/components/TextField';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { isAiConfigured, loadAiSettings } from '@/lib/ai/settings';
import {
  WORKFLOW_INSTRUCTION_MAX,
  WORKFLOW_NAME_MAX,
  WorkflowStore,
  runWorkflow,
  validateWorkflowDraft,
  type RunStatus,
  type Workflow,
  type WorkflowRun,
} from '@/lib/workflows';
import { fonts, radius, spacing } from '@/theme';

type Tab = 'workflows' | 'runs';

const TEMPLATES = [
  {
    name: 'Daily briefing',
    instruction: 'List my open tasks, point out what is due today or overdue, and suggest what to do first.',
  },
  {
    name: 'Overdue cleanup',
    instruction: 'Find my overdue tasks and suggest which ones to reschedule or drop.',
  },
];

function timeAgo(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));

  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} d ago`;
}

const STATUS_LABEL: Record<RunStatus, string> = {
  running: 'Running',
  success: 'Success',
  failed: 'Failed',
};

export default function WorkflowsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();

  const [tab, setTab] = useState<Tab>('workflows');
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [runningId, setRunningId] = useState<number | null>(null);
  const [expandedRunId, setExpandedRunId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftInstruction, setDraftInstruction] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;

    try {
      const store = new WorkflowStore(db);

      await store.recoverStaleRuns(user.id);

      const [nextWorkflows, nextRuns, settings] = await Promise.all([
        store.list(user.id),
        store.listRuns(user.id),
        loadAiSettings(),
      ]);

      setWorkflows(nextWorkflows);
      setRuns(nextRuns);
      setAiReady(isAiConfigured(settings));
    } catch (loadError) {
      console.warn('Could not load workflows.', loadError);
      setError('Could not load your workflows.');
    } finally {
      setIsLoaded(true);
    }
  }, [db, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!user) return null;

  const activeUser = user;

  function openSheet(workflow?: Workflow, template?: { name: string; instruction: string }) {
    setEditingId(workflow?.id ?? null);
    setDraftName(workflow?.name ?? template?.name ?? '');
    setDraftInstruction(workflow?.instruction ?? template?.instruction ?? '');
    setFormError(null);
    setSheetOpen(true);
  }

  async function save() {
    const problem = validateWorkflowDraft(draftName, draftInstruction);

    if (problem) {
      setFormError(problem);
      return;
    }

    setIsSaving(true);

    try {
      const store = new WorkflowStore(db);

      if (editingId === null) {
        await store.create(activeUser.id, draftName, draftInstruction);
      } else {
        await store.update(activeUser.id, editingId, draftName, draftInstruction);
      }

      setSheetOpen(false);
      await load();
    } catch (saveError) {
      console.warn('Could not save the workflow.', saveError);
      setFormError('Could not save the workflow. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  function confirmDelete(workflow: Workflow) {
    Alert.alert(
      `Delete “${workflow.name}”?`,
      'The workflow and its run history will be removed. Chats from past runs stay in your chat list.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await new WorkflowStore(db).remove(activeUser.id, workflow.id);
                await load();
              } catch (deleteError) {
                console.warn('Could not delete the workflow.', deleteError);
                setError('Could not delete the workflow.');
              }
            })();
          },
        },
      ]
    );
  }

  async function run(workflow: Workflow) {
    if (runningId !== null) return;

    setError(null);
    setRunningId(workflow.id);

    try {
      const finished = await runWorkflow(db, activeUser, workflow);

      await load();
      setTab('runs');
      setExpandedRunId(finished.id);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Could not run the workflow.');
    } finally {
      setRunningId(null);
    }
  }

  async function refresh() {
    setIsRefreshing(true);
    await load();
    setIsRefreshing(false);
  }

  function openRunChat(run: WorkflowRun, openedAt: number) {
    if (run.conversationId === null) return;

    router.navigate(`/chat?c=${run.conversationId}&t=${openedAt}` as Href);
  }

  function statusColor(status: RunStatus): string {
    if (status === 'success') return colors.success;
    if (status === 'failed') return colors.danger;
    return colors.accent;
  }

  function renderWorkflow(workflow: Workflow) {
    const isRunning = runningId === workflow.id;

    return (
      <GlassView key={workflow.id} style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Edit workflow ${workflow.name}`}
          onPress={() => openSheet(workflow)}
          style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
        >
          <Text style={styles.cardTitle}>{workflow.name}</Text>
          <Text numberOfLines={3} style={styles.cardText}>
            {workflow.instruction}
          </Text>
          <View style={styles.metaRow}>
            <Ionicons name="time-outline" size={14} color={colors.textFaint} />
            <Text style={styles.metaText}>
              {workflow.lastRunAt
                ? `Last run ${timeAgo(workflow.lastRunAt)} · ${workflow.runCount} run${workflow.runCount === 1 ? '' : 's'}`
                : 'Never run'}
            </Text>
            {workflow.lastRunStatus && workflow.lastRunStatus !== 'running' ? (
              <View style={[styles.dot, { backgroundColor: statusColor(workflow.lastRunStatus) }]} />
            ) : null}
          </View>
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Run workflow ${workflow.name}`}
            disabled={runningId !== null}
            onPress={() => {
              void run(workflow);
            }}
            style={({ pressed }) => [
              styles.runButton,
              runningId !== null && !isRunning && styles.disabled,
              pressed && styles.pressed,
            ]}
          >
            {isRunning ? (
              <ActivityIndicator size="small" color={colors.onInverse} />
            ) : (
              <Ionicons name="play" size={16} color={colors.onInverse} />
            )}
            <Text style={styles.runButtonText}>{isRunning ? 'Running…' : 'Run now'}</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete workflow ${workflow.name}`}
            onPress={() => confirmDelete(workflow)}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <Ionicons name="trash-outline" size={20} color={colors.danger} />
          </Pressable>
        </View>
      </GlassView>
    );
  }

  function renderRun(item: WorkflowRun) {
    const expanded = expandedRunId === item.id;
    const color = statusColor(item.status);

    return (
      <GlassView key={item.id} style={styles.card}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${item.workflowName}, ${STATUS_LABEL[item.status]}`}
          onPress={() => setExpandedRunId(expanded ? null : item.id)}
          style={({ pressed }) => [styles.cardBody, pressed && styles.pressed]}
        >
          <View style={styles.runHeader}>
            <Text numberOfLines={1} style={[styles.cardTitle, styles.flex]}>
              {item.workflowName}
            </Text>
            <View style={[styles.chip, { backgroundColor: `${color}26` }]}>
              <Text style={[styles.chipText, { color }]}>{STATUS_LABEL[item.status]}</Text>
            </View>
          </View>
          <Text style={styles.metaText}>{timeAgo(item.startedAt)}</Text>
          {item.summary ? (
            <Text numberOfLines={expanded ? undefined : 3} style={styles.cardText}>
              {item.summary}
            </Text>
          ) : null}
          {expanded && item.traces.length > 0 ? (
            <View style={styles.traces}>
              {item.traces.map((trace, index) => (
                <View key={`${item.id}-${index}`} style={styles.traceRow}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.success} />
                  <Text style={styles.traceText}>{trace}</Text>
                </View>
              ))}
            </View>
          ) : null}
        </Pressable>

        {expanded && item.conversationId !== null ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => openRunChat(item, Date.now())}
            style={({ pressed }) => [styles.openChat, pressed && styles.pressed]}
          >
            <Text style={styles.openChatText}>Open full transcript</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.accent} />
          </Pressable>
        ) : null}
      </GlassView>
    );
  }

  const showEmptyWorkflows = isLoaded && workflows.length === 0;
  const showEmptyRuns = isLoaded && runs.length === 0;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xl + insets.bottom },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={() => {
              void refresh();
            }}
            tintColor={colors.accent}
            colors={[colors.accent]}
            progressBackgroundColor={colors.surface}
          />
        }
      >
        <ScreenHeader
          title="Workflows"
          subtitle="Save an instruction once, run it whenever you need."
          left={<SidebarButton onPress={openSidebar} />}
        />

        {aiReady === false ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.navigate('/settings')}
            style={({ pressed }) => [styles.notice, pressed && styles.pressed]}
          >
            <Ionicons name="key-outline" size={16} color={colors.accent} />
            <Text style={styles.noticeText}>
              Local mode only understands basic commands. Add an API key so workflows can do multi-step work.
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
          </Pressable>
        ) : null}

        {error ? (
          <View style={styles.block}>
            <FormError message={error} onDismiss={() => setError(null)} />
          </View>
        ) : null}

        <View accessibilityRole="tablist" style={styles.tabs}>
          {(['workflows', 'runs'] as const).map((option) => {
            const active = tab === option;

            return (
              <Pressable
                key={option}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => setTab(option)}
                style={[styles.tab, active && styles.tabActive]}
              >
                <Text style={[styles.tabText, active && styles.tabTextActive]}>
                  {option === 'workflows' ? `My workflows (${workflows.length})` : `Runs (${runs.length})`}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'workflows' ? (
          <View style={styles.list}>
            {workflows.length > 0 ? (
              <Button label="New workflow" onPress={() => openSheet()} />
            ) : null}

            {!isLoaded ? (
              <>
                <Skeleton height={132} radius={radius.lg} />
                <Skeleton height={132} radius={radius.lg} />
              </>
            ) : null}

            {workflows.map(renderWorkflow)}

            {showEmptyWorkflows ? (
              <>
                <EmptyState
                  icon="flash-outline"
                  title="No workflows yet"
                  message="A workflow is an instruction you reuse — like a daily briefing. The agent follows it each time you run it."
                  actionLabel="New workflow"
                  onAction={() => openSheet()}
                />
                <Text style={styles.sectionLabel}>Start from a template</Text>
                {TEMPLATES.map((template) => (
                  <Pressable
                    key={template.name}
                    accessibilityRole="button"
                    onPress={() => openSheet(undefined, template)}
                    style={({ pressed }) => [styles.template, pressed && styles.pressed]}
                  >
                    <View style={styles.flex}>
                      <Text style={styles.cardTitle}>{template.name}</Text>
                      <Text numberOfLines={2} style={styles.cardText}>
                        {template.instruction}
                      </Text>
                    </View>
                    <Ionicons name="add" size={22} color={colors.textMuted} />
                  </Pressable>
                ))}
              </>
            ) : null}
          </View>
        ) : (
          <View style={styles.list}>
            {!isLoaded ? <Skeleton height={96} radius={radius.lg} /> : null}
            {runs.map(renderRun)}
            {showEmptyRuns ? (
              <EmptyState
                icon="time-outline"
                title="No runs yet"
                message="Run a workflow and its result will show up here, with a link to the full transcript."
              />
            ) : null}
          </View>
        )}
      </ScrollView>

      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetOpen(false)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.sheetRoot}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={() => setSheetOpen(false)}
            style={styles.scrim}
          />
          <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
            <Text accessibilityRole="header" style={styles.sheetTitle}>
              {editingId === null ? 'New workflow' : 'Edit workflow'}
            </Text>

            <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.sheetBody}>
              <TextField
                label="Name"
                value={draftName}
                onChangeText={setDraftName}
                placeholder="Daily briefing"
                maxLength={WORKFLOW_NAME_MAX}
              />
              <TextField
                label="What should it do?"
                value={draftInstruction}
                onChangeText={setDraftInstruction}
                placeholder="List my open tasks and tell me what is due today."
                multiline
                maxLength={WORKFLOW_INSTRUCTION_MAX}
                hint={`${draftInstruction.length}/${WORKFLOW_INSTRUCTION_MAX}`}
              />
              <FormError message={formError} />
              <Button label="Save workflow" onPress={() => void save()} loading={isSaving} />
              <Button label="Cancel" variant="secondary" onPress={() => setSheetOpen(false)} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: {
      flex: 1,
    },
    content: {
      paddingHorizontal: spacing.md,
      gap: spacing.md,
    },
    block: {
      marginTop: spacing.xs,
    },
    notice: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
    },
    noticeText: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    tabs: {
      flexDirection: 'row',
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      padding: 4,
    },
    tab: {
      flex: 1,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
    },
    tabActive: {
      backgroundColor: colors.surfaceAlt,
    },
    tabText: {
      color: colors.textMuted,
      fontSize: 14,
      fontWeight: '600',
    },
    tabTextActive: {
      color: colors.text,
    },
    list: {
      gap: spacing.sm + 2,
    },
    card: {
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardBody: {
      gap: spacing.xs,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    cardText: {
      color: colors.textMuted,
      fontSize: 14,
      lineHeight: 21,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      marginTop: 2,
    },
    metaText: {
      color: colors.textFaint,
      fontSize: 12,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    runButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      minHeight: 48,
      borderRadius: radius.pill,
      backgroundColor: colors.inverse,
    },
    runButtonText: {
      color: colors.onInverse,
      fontSize: 15,
      fontWeight: '700',
    },
    iconButton: {
      width: 48,
      height: 48,
      borderRadius: 24,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.dangerSoft,
    },
    disabled: {
      opacity: 0.45,
    },
    runHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    chip: {
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    chipText: {
      fontSize: 12,
      fontWeight: '700',
    },
    traces: {
      gap: 6,
      marginTop: spacing.xs,
    },
    traceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    traceText: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 13,
    },
    openChat: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minHeight: 44,
    },
    openChatText: {
      color: colors.accent,
      fontSize: 14,
      fontWeight: '600',
    },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 15,
      fontWeight: '600',
      marginTop: spacing.sm,
    },
    template: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
    },
    pressed: {
      opacity: 0.8,
    },
    sheetRoot: {
      flex: 1,
      justifyContent: 'flex-end',
    },
    scrim: {
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
    },
    sheet: {
      maxHeight: '90%',
      backgroundColor: colors.background,
      borderTopLeftRadius: radius.xl,
      borderTopRightRadius: radius.xl,
      paddingTop: spacing.lg,
      paddingHorizontal: spacing.md,
    },
    sheetTitle: {
      color: colors.text,
      fontFamily: fonts.serif,
      fontSize: 26,
      fontWeight: '600',
      marginBottom: spacing.md,
    },
    sheetBody: {
      gap: spacing.md,
      paddingBottom: spacing.md,
    },
  });
