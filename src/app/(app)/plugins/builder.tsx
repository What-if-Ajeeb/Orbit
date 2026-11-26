import Ionicons from '@expo/vector-icons/Ionicons';
import { setStringAsync as copyToClipboard } from 'expo-clipboard';
import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SettingsSection } from '@/components/SettingsSection';
import { SidebarButton } from '@/components/SidebarButton';
import { TextField } from '@/components/TextField';
import {
  BuilderChipGroup,
  BuilderFeedback,
  BuilderInfo,
  BuilderJsonField,
  BuilderStepper,
  BuilderToggleRow,
} from '@/components/plugins/BuilderControls';
import { usePluginPlatform, usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  BUILDER_ICON_CHOICES,
  BUILDER_PRESET_LABELS,
  BUILDER_SANDBOX_PRESETS,
  createBuilderAction,
  createEmptyDraft,
  parseJsonObject,
  validateAndBuild,
  type BuilderAction,
  type BuilderDraft,
  type BuilderRunResult,
  type BuilderSandboxPreset,
} from '@/lib/plugins/builder';
import {
  exportBuilderManifest,
  installBuilderDraft,
  prepareBuilderDraftForPublish,
  previewBuilderManifest,
  testBuilderAction,
} from '@/lib/plugins/builder-service';
import { loadBuilderDrafts } from '@/lib/plugins/builder-store';
import { PLUGIN_PERMISSION_META } from '@/lib/plugins/permissions';
import {
  PLUGIN_CAPABILITIES,
  PLUGIN_CATEGORIES,
  PLUGIN_PERMISSIONS,
  type PluginCapability,
  type PluginCategory,
  type PluginPermission,
} from '@/lib/plugins/types';
import { formatRelative } from '@/lib/dates';
import { layout, radius, spacing, typography } from '@/theme';
import { editorText } from '@/lib/plugins/builder-editor';

const STEPS = ['Basic Info', 'Configuration', 'Actions & Tools', 'Testing', 'Save & Install'];

const CAPABILITY_LABELS: Record<PluginCapability, string> = {
  'ui.screens': 'Plugin screen',
  'ui.navigation': 'Navigation entry',
  'ui.widgets': 'Dashboard widgets',
  'ui.settings': 'Settings screen',
  'ui.toolbar': 'Toolbar actions',
  'ui.context-menu': 'Context menu',
  'tools.ai': 'Expose AI tools',
  'tools.mcp': 'MCP tools',
  'provider.llm': 'LLM provider',
  'storage.namespaced': 'Namespaced storage',
  'events.publish': 'Publish events',
  'events.subscribe': 'Subscribe to events',
  'automation.triggers': 'Automation triggers',
  'background.tasks': 'Background tasks',
  'integration.mcp': 'MCP integration',
  'ai.context': 'AI context',
};

const PERMISSION_CHOICES: { value: PluginPermission; label: string }[] =
  PLUGIN_PERMISSIONS.map((permission) => ({
    value: permission,
    label: PLUGIN_PERMISSION_META[permission].label,
  }));

const CATEGORY_CHOICES: { value: PluginCategory; label: string }[] =
  PLUGIN_CATEGORIES.map((category) => ({
    value: category,
    label: category.charAt(0).toUpperCase() + category.slice(1),
  }));

function capabilityLabel(capability: PluginCapability): string {
  return CAPABILITY_LABELS[capability] ?? capability;
}

export default function PluginBuilderScreen() {
  const params = useLocalSearchParams<{ pluginId?: string }>();
  const editingId = params.pluginId ? decodeURIComponent(params.pluginId) : '';
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { open: openSidebar } = useSidebar();
  const platform = usePluginPlatform();
  const snapshot = usePluginSnapshot();

  const [draft, setDraft] = useState<BuilderDraft>(() => createEmptyDraft());
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(Boolean(editingId));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inputTexts, setInputTexts] = useState<Record<string, string>>({});
  const [testActionId, setTestActionId] = useState('');
  const [testInput, setTestInput] = useState('{\n  "value": "hello"\n}');
  const [testResult, setTestResult] = useState<BuilderRunResult | null>(null);
  const [testing, setTesting] = useState(false);

  const validation = useMemo(() => validateAndBuild(draft), [draft]);
  const previewText = useMemo(() => {
    if (step !== 4) return '';

    try {
      return JSON.stringify(previewBuilderManifest(draft), null, 2);
    } catch (previewError) {
      return previewError instanceof Error ? previewError.message : 'Preview unavailable.';
    }
  }, [step, draft]);
  const record = editingId ? platform.registry.getRecord(editingId) : null;
  const installed = Boolean(record && ['installed', 'disabled', 'running', 'enabled', 'error'].includes(record.status));

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        let next: BuilderDraft | null = null;

        if (editingId) {
          const drafts = await loadBuilderDrafts(platform.persistence);
          next = drafts.find((entry) => entry.pluginId === editingId) ?? null;
        }

        if (active) {
          const resolved = next ?? createEmptyDraft();
          setDraft(resolved);
          setInputTexts(editorText(resolved));
          setTestActionId(resolved.actions[0]?.id ?? '');
          setTestInput(editorText(resolved).testInput);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load the draft.'
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [editingId, platform.persistence]);

  const update = useCallback(<K extends keyof BuilderDraft>(key: K, value: BuilderDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value, updatedAt: Date.now() }));
    setError(null);
  }, []);

  const updateJson = useCallback(
    (key: string, text: string, field: 'inputParameters' | 'settings') => {
      setInputTexts((current) => ({ ...current, [key]: text }));
      const parsed = parseJsonObject(text, field === 'settings' ? 'Settings' : 'Input parameters');

      if (parsed.ok) {
        if (field === 'settings') {
          setDraft((current) => ({
            ...current,
            settings: Array.isArray(parsed.value) ? (parsed.value as BuilderDraft['settings']) : [],
            updatedAt: Date.now(),
          }));
        } else {
          update('inputParameters', parsed.value);
        }
        setError(null);
      } else {
        setError(parsed.error);
      }
    },
    [update]
  );

  async function saveDraft(): Promise<BuilderDraft | null> {
    setSaving(true);
    setError(null);
    try {
      const { saveBuilderDraft } = await import('@/lib/plugins/builder-store');
      const saved = await saveBuilderDraft(platform.persistence, draft);
      setDraft(saved);
      setNotice(`Draft “${saved.name || saved.pluginId}” saved.`);
      return saved;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Could not save the draft.');
      return null;
    } finally {
      setSaving(false);
    }
  }

  function nextStep() {
    if (step < STEPS.length - 1) {
      setStep((current) => current + 1);
      setNotice(null);
    }
  }

  function previousStep() {
    if (step > 0) setStep((current) => current - 1);
  }

  async function runTest() {
    setTesting(true);
    setError(null);
    setNotice(null);
    try {
      const parsed = parseJsonObject(testInput, 'Test input');
      if (!parsed.ok) throw new Error(parsed.error);
      const result = await testBuilderAction(draft, testActionId, parsed.value, {
        persistence: platform.persistence,
      });
      setTestResult(result);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Test failed.');
    } finally {
      setTesting(false);
    }
  }

  async function install() {
    if (!validation.ok) {
      setError('Fix validation issues before installing.');
      return;
    }

    const saved = await saveDraft();
    if (!saved) return;

    setSaving(true);
    try {
      const result = await installBuilderDraft(platform, saved);
      if (!result.ok) {
        setError(result.errors.join(' ') || 'Install failed.');
        return;
      }
      setNotice(
        result.record?.status === 'running'
          ? 'Plugin installed and running. Its tools are available to agents.'
          : 'Plugin installed. Enable it when you are ready.'
      );
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : 'Install failed.');
    } finally {
      setSaving(false);
    }
  }

  function exportManifest() {
    try {
      const json = exportBuilderManifest(draft);
      void copyToClipboard(json);
      setNotice('Canonical manifest copied to clipboard.');
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Export failed.');
    }
  }

  async function markForReview() {
    try {
      const prepared = prepareBuilderDraftForPublish(draft);
      setDraft(prepared);
      const { saveBuilderDraft } = await import('@/lib/plugins/builder-store');
      await saveBuilderDraft(platform.persistence, prepared);
      setNotice(
        'Marked ready for review. Publishing requires a separate, reviewed submission.'
      );
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Could not mark for review.');
    }
  }

  if (loading) {
    return (
      <View style={styles.root}>
        <GlassBackdrop />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={colors.accent} />
          <Text style={styles.loadingText}>Loading builder…</Text>
        </View>
      </View>
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
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.headerRow}>
          <SidebarButton onPress={openSidebar} />
          <ScreenHeader
            title={editingId ? 'Edit Plugin' : 'Create Plugin'}
            subtitle="Build a safe, declarative plugin in five guided steps."
          />
        </View>

        <BuilderStepper steps={STEPS} active={step} onSelect={setStep} />

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

        {step === 0 ? (
          <BasicInfoStep
            draft={draft}
            update={update}
            installed={installed}
            styles={styles}
          />
        ) : null}
        {step === 1 ? (
          <ConfigurationStep
            draft={draft}
            update={update}
            updateJson={updateJson}
            inputTexts={inputTexts}
            styles={styles}
          />
        ) : null}
        {step === 2 ? (
          <ActionsStep
            draft={draft}
            setDraft={setDraft}
            inputTexts={inputTexts}
            setInputTexts={setInputTexts}
            styles={styles}
          />
        ) : null}
        {step === 3 ? (
          <TestingStep
            draft={draft}
            testActionId={testActionId}
            setTestActionId={setTestActionId}
            testInput={testInput}
            setTestInput={setTestInput}
            testResult={testResult}
            testing={testing}
            onRun={runTest}
            styles={styles}
          />
        ) : null}
        {step === 4 ? (
          <SaveStep
            draft={draft}
            validation={validation}
            previewText={previewText}
            installed={installed}
            saving={saving}
            onSave={() => {
              void saveDraft();
            }}
            onInstall={() => {
              void install();
            }}
            onExport={exportManifest}
            onPrepare={() => {
              void markForReview();
            }}
            onHistory={() => {
              if (draft.pluginId) {
                router.navigate(`/plugins/${encodeURIComponent(draft.pluginId)}` as Href);
              }
            }}
            styles={styles}
          />
        ) : null}

        <View style={styles.navigationRow}>
          <Button
            label="Back"
            variant="secondary"
            onPress={previousStep}
            disabled={step === 0}
            style={styles.navButton}
          />
          {step < STEPS.length - 1 ? (
            <Button label="Continue" onPress={nextStep} style={styles.navButton} />
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          onPress={() => router.navigate('/plugins/my-plugins' as Href)}
          style={({ pressed }) => [styles.backLink, pressed && styles.pressed]}
        >
          <Ionicons name="arrow-back-outline" size={15} color={colors.accent} />
          <Text style={styles.backLinkText}>Back to My Plugins</Text>
        </Pressable>

        <Text style={styles.footnote}>
          Local plugins run as fixed sandbox programs only. No user-authored code is executed
          in the app process. Platform: {snapshot.ready ? platform.platform : 'loading'} ·{' '}
          {formatRelative(draft.updatedAt)}
        </Text>
      </ScrollView>
    </View>
  );
}

type StepStyles = ReturnType<typeof makeStyles> extends infer S ? S : never;

function BasicInfoStep({
  draft,
  update,
  installed,
  styles,
}: {
  draft: BuilderDraft;
  update: <K extends keyof BuilderDraft>(key: K, value: BuilderDraft[K]) => void;
  installed: boolean;
  styles: StepStyles;
}) {
  const { colors } = useAppTheme();

  function toggleTag(tag: string) {
    update(
      'tags',
      draft.tags.includes(tag) ? draft.tags.filter((item) => item !== tag) : [...draft.tags, tag]
    );
  }

  return (
    <SettingsSection
      title="Basic Information"
      description="Identity shown in the plugin library. The ID cannot be changed after install."
    >
      <TextField
        label="Plugin ID"
        value={draft.pluginId}
        onChangeText={(value) => update('pluginId', value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
        placeholder="my.useful.plugin"
        hint={
          installed
            ? 'Installed plugins keep their ID. Increase the version to update.'
            : 'Lowercase letters, numbers, dots or dashes. Reserved ORBIT prefixes are blocked.'
        }
        autoCapitalize="none"
        autoCorrect={false}
        editable={!installed}
      />
      <TextField
        label="Name"
        value={draft.name}
        onChangeText={(value) => update('name', value)}
        placeholder="My Useful Plugin"
      />
      <TextField
        label="Description"
        value={draft.description}
        onChangeText={(value) => update('description', value)}
        placeholder="What does this plugin do?"
        multiline
      />
      <TextField
        label="Author"
        value={draft.author}
        onChangeText={(value) => update('author', value)}
        placeholder="Your name"
      />
      <TextField
        label="Version"
        value={draft.version}
        onChangeText={(value) => update('version', value)}
        placeholder="1.0.0"
        hint="Increase this when updating an installed plugin."
      />
      <BuilderChipGroup
        label="Category"
        options={CATEGORY_CHOICES}
        values={[draft.category]}
        onToggle={(value) => update('category', value)}
      />
      <BuilderChipGroup
        label="Icon"
        options={BUILDER_ICON_CHOICES.map((icon) => ({
          value: icon,
          label: icon.replace('-outline', '').replace(/-/g, ' '),
        }))}
        values={[draft.icon]}
        onToggle={(value) => update('icon', value)}
      />
      <View style={styles.field}>
        <Text style={styles.label}>Tags (optional)</Text>
        <View style={styles.chips}>
          {['productivity', 'utility', 'ai', 'media'].map((tag) => {
            const selected = draft.tags.includes(tag);
            return (
              <Pressable
                key={tag}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                onPress={() => toggleTag(tag)}
                style={({ pressed }) => [
                  styles.chip,
                  selected && styles.chipSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{tag}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.hint}>
          Tags are editor metadata only and are not part of the installed manifest.
        </Text>
      </View>
      <BuilderInfo>
        Build plugins are always local, unsigned and declarative. Publishing requires a
        separate reviewed submission; this builder never publishes automatically.
      </BuilderInfo>
      <Text style={styles.mutedText}>Accent: {colors.accent}</Text>
    </SettingsSection>
  );
}

function ConfigurationStep({
  draft,
  update,
  updateJson,
  inputTexts,
  styles,
}: {
  draft: BuilderDraft;
  update: <K extends keyof BuilderDraft>(key: K, value: BuilderDraft[K]) => void;
  updateJson: (key: string, text: string, field: 'inputParameters' | 'settings') => void;
  inputTexts: Record<string, string>;
  styles: StepStyles;
}) {
  const { colors } = useAppTheme();

  function toggleCapability(capability: PluginCapability) {
    update(
      'capabilities',
      draft.capabilities.includes(capability)
        ? draft.capabilities.filter((item) => item !== capability)
        : [...draft.capabilities, capability]
    );
  }

  function togglePermission(permission: PluginPermission) {
    update(
      'permissions',
      draft.permissions.includes(permission)
        ? draft.permissions.filter((item) => item !== permission)
        : [...draft.permissions, permission]
    );
  }

  function toggleIntegration(value: string) {
    update(
      'integrations',
      draft.integrations.includes(value)
        ? draft.integrations.filter((item) => item !== value)
        : [...draft.integrations, value]
    );
  }

  function setEnvironment(index: number, patch: Partial<BuilderDraft['environment'][number]>) {
    const next = draft.environment.map((entry, position) =>
      position === index ? { ...entry, ...patch } : entry
    );
    update('environment', next);
  }

  return (
    <>
      <SettingsSection
        title="Configuration"
        description="Capabilities and permissions are least-privilege. Sensitive access always asks again."
      >
        <TextField
          label="Minimum ORBIT version"
          value={draft.minimumOrbitVersion}
          onChangeText={(value) => update('minimumOrbitVersion', value)}
          placeholder="1.0.0"
        />
        <BuilderJsonField
          label="Input parameters (JSON object)"
          value={inputTexts.input ?? ''}
          onChange={(value) => updateJson('input', value, 'inputParameters')}
          hint="Optional. Describes the plugin's general input shape."
          error={validateJsonHint(inputTexts.input ?? '')}
        />
        <BuilderChipGroup
          label="Capabilities"
          options={PLUGIN_CAPABILITIES.map((capability) => ({
            value: capability,
            label: capabilityLabel(capability),
          }))}
          values={draft.capabilities}
          onToggle={toggleCapability}
        />
        <BuilderChipGroup
          label="Permissions"
          options={PERMISSION_CHOICES}
          values={draft.permissions}
          onToggle={togglePermission}
        />
        <BuilderInfo>
          Permissions never auto-grant. When the plugin is enabled, ORBIT asks for explicit
          approval and stores grants in the canonical permission manager.
        </BuilderInfo>
      </SettingsSection>

      <SettingsSection
        title="Settings schema (optional)"
        description="JSON array of canonical setting fields. Empty means no settings screen."
      >
        <BuilderJsonField
          label="Settings"
          value={inputTexts.settings ?? ''}
          onChange={(value) => updateJson('settings', value, 'settings')}
          placeholder='[{"key":"apiMode","type":"select","label":"Mode","options":[{"value":"fast","label":"Fast"}]}]'
          error={validateJsonHint(inputTexts.settings ?? '')}
        />
      </SettingsSection>

      <SettingsSection
        title="Integrations & credentials"
        description="Reference other plugins or MCP servers by ID. Never paste secret values here."
      >
        <BuilderChipGroup
          label="Plugin integrations"
          options={[
            { value: 'orbit.core.session', label: 'Core session' },
            { value: 'orbit.core.agent', label: 'Core agent' },
          ]}
          values={draft.integrations.filter((entry) => !entry.startsWith('mcp:'))}
          onToggle={toggleIntegration}
        />
        <TextField
          label="MCP server reference"
          value={draft.integrations.find((entry) => entry.startsWith('mcp:')) ?? ''}
          onChangeText={(value) => {
            const others = draft.integrations.filter((entry) => !entry.startsWith('mcp:'));
            update('integrations', value.trim() ? [...others, value.trim()] : others);
          }}
          placeholder="mcp:my-server"
          hint="Stored as a reference only. Tokens remain in secure MCP settings."
          autoCapitalize="none"
        />
        <View style={styles.field}>
          <Text style={styles.label}>Environment references</Text>
          {draft.environment.map((entry, index) => (
            <View key={`${entry.key}-${index}`} style={styles.envRow}>
              <TextInput
                accessibilityLabel="Environment key"
                value={entry.key}
                onChangeText={(value) => setEnvironment(index, { key: value })}
                placeholder="API_KEY"
                style={styles.envInput}
                autoCapitalize="characters"
              />
              <BuilderToggleRow
                label="Secret"
                description={entry.secret ? 'Stored in SecureStore' : 'Plain default'}
                checked={entry.secret}
                onToggle={() => setEnvironment(index, { secret: !entry.secret })}
              />
              {!entry.secret ? (
                <TextInput
                  accessibilityLabel="Default value"
                  value={entry.value ?? ''}
                  onChangeText={(value) => setEnvironment(index, { value })}
                  placeholder="non-secret default"
                  style={styles.envInput}
                />
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove environment entry"
                onPress={() =>
                  update(
                    'environment',
                    draft.environment.filter((_, position) => position !== index)
                  )
                }
                style={styles.removeButton}
              >
                <Ionicons name="trash-outline" size={18} color={colors.danger} />
              </Pressable>
            </View>
          ))}
          <Button
            label="Add environment reference"
            variant="secondary"
            onPress={() =>
              update('environment', [
                ...draft.environment,
                { key: `KEY_${draft.environment.length + 1}`, secret: true },
              ])
            }
          />
        </View>
      </SettingsSection>
    </>
  );
}

function validateJsonHint(text: string): string | null {
  if (!text.trim()) return null;
  return parseJsonObject(text, 'JSON').ok ? null : 'Invalid JSON.';
}

function ActionsStep({
  draft,
  setDraft,
  inputTexts,
  setInputTexts,
  styles,
}: {
  draft: BuilderDraft;
  setDraft: React.Dispatch<React.SetStateAction<BuilderDraft>>;
  inputTexts: Record<string, string>;
  setInputTexts: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  styles: StepStyles;
}) {
  const { colors } = useAppTheme();

  function patchAction(id: string, patch: Partial<BuilderAction>) {
    setDraft((current) => ({
      ...current,
      actions: current.actions.map((action) =>
        action.id === id ? { ...action, ...patch } : action
      ),
      updatedAt: Date.now(),
    }));
  }

  function addAction() {
    setDraft((current) => ({
      ...current,
      actions: [...current.actions, createBuilderAction(current.actions.length)],
      updatedAt: Date.now(),
    }));
  }

  function removeAction(id: string) {
    setDraft((current) => ({
      ...current,
      actions: current.actions.filter((action) => action.id !== id),
      updatedAt: Date.now(),
    }));
  }

  function updateSchema(actionId: string, field: 'inputSchema' | 'outputSchema', text: string) {
    setInputTexts((current) => ({ ...current, [`${actionId}.${field}`]: text }));
    const parsed = parseJsonObject(text, field === 'inputSchema' ? 'Input schema' : 'Output schema');
    if (!parsed.ok) return;

    if (field === 'inputSchema') {
      patchAction(actionId, { inputSchema: parsed.value });
    } else {
      patchAction(actionId, { outputSchema: parsed.value });
    }
  }

  return (
    <SettingsSection
      title="Actions & Tools"
      description="Each action compiles to one fixed sandbox program. No host JavaScript is generated."
      action={
        <Text style={styles.count}>
          {draft.actions.length} action{draft.actions.length === 1 ? '' : 's'}
        </Text>
      }
    >
      {draft.actions.length === 0 ? (
        <View style={styles.emptyInline}>
          <Text style={styles.emptyInlineText}>
            No actions yet. Add one to expose a tool to agents and the testing playground.
          </Text>
          <Button label="Add action" onPress={addAction} />
        </View>
      ) : (
        <View style={styles.list}>
          {draft.actions.map((action, index) => (
            <GlassView key={`${action.id}-${index}`} style={styles.actionCard}>
              <View style={styles.actionHeader}>
                <Text style={styles.actionTitle}>Action {index + 1}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove action ${index + 1}`}
                  onPress={() => removeAction(action.id)}
                  style={styles.removeButton}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.danger} />
                </Pressable>
              </View>
              <TextField
                label="Tool name"
                value={action.id}
                onChangeText={(value) =>
                  patchAction(action.id, {
                    id: value.toLowerCase().replace(/[^a-z0-9_-]/g, ''),
                  })
                }
                placeholder="my_action"
                hint="Agent tool name lowercase letters, numbers, dash or underscore."
              />
              <TextField
                label="Display name"
                value={action.name}
                onChangeText={(value) => patchAction(action.id, { name: value })}
              />
              <TextField
                label="Description"
                value={action.description}
                onChangeText={(value) => patchAction(action.id, { description: value })}
                multiline
              />
              <View style={styles.field}>
                <Text style={styles.label}>Sandbox preset</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chips}>
                    {BUILDER_SANDBOX_PRESETS.map((preset) => {
                      const selected = action.handler.preset === preset;
                      return (
                        <Pressable
                          key={preset}
                          accessibilityRole="button"
                          accessibilityState={{ selected }}
                          onPress={() =>
                            patchAction(action.id, {
                              handler: { ...action.handler, preset },
                            })
                          }
                          style={({ pressed }) => [
                            styles.chip,
                            selected && styles.chipSelected,
                            pressed && styles.pressed,
                          ]}
                        >
                          <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                            {preset}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </ScrollView>
                <Text style={styles.hint}>
                  {BUILDER_PRESET_LABELS[action.handler.preset as BuilderSandboxPreset]}
                </Text>
              </View>
              {action.handler.preset === 'echo' ||
              action.handler.preset === 'concat' ||
              action.handler.preset === 'sum' ? (
                <TextField
                  label={action.handler.preset === 'sum' ? 'First number field' : 'Input field'}
                  value={action.handler.field ?? ''}
                  onChangeText={(value) =>
                    patchAction(action.id, {
                      handler: { ...action.handler, field: value },
                    })
                  }
                  placeholder={action.handler.preset === 'sum' ? 'a' : 'value'}
                />
              ) : null}
              {action.handler.preset === 'sum' ? (
                <TextField
                  label="Second number field"
                  value={action.handler.fieldB ?? ''}
                  onChangeText={(value) =>
                    patchAction(action.id, {
                      handler: { ...action.handler, fieldB: value },
                    })
                  }
                  placeholder="b"
                />
              ) : null}
              {action.handler.preset === 'concat' ? (
                <TextField
                  label="Prefix"
                  value={action.handler.prefix ?? ''}
                  onChangeText={(value) =>
                    patchAction(action.id, {
                      handler: { ...action.handler, prefix: value },
                    })
                  }
                />
              ) : null}
              {action.handler.preset === 'constant' ? (
                <TextField
                  label="Constant value"
                  value={String(action.handler.value ?? '')}
                  onChangeText={(value) =>
                    patchAction(action.id, {
                      handler: { ...action.handler, value },
                    })
                  }
                />
              ) : null}
              <BuilderJsonField
                label="Input schema (JSON)"
                value={inputTexts[`${action.id}.inputSchema`] ?? JSON.stringify(action.inputSchema)}
                onChange={(value) => updateSchema(action.id, 'inputSchema', value)}
                error={validateJsonHint(inputTexts[`${action.id}.inputSchema`] ?? '')}
              />
              <BuilderJsonField
                label="Output schema (JSON)"
                value={inputTexts[`${action.id}.outputSchema`] ?? JSON.stringify(action.outputSchema)}
                onChange={(value) => updateSchema(action.id, 'outputSchema', value)}
                error={validateJsonHint(inputTexts[`${action.id}.outputSchema`] ?? '')}
              />
              <BuilderChipGroup
                label="Action permissions"
                options={PERMISSION_CHOICES}
                values={action.permissions}
                onToggle={(permission) =>
                  patchAction(action.id, {
                    permissions: action.permissions.includes(permission)
                      ? action.permissions.filter((item) => item !== permission)
                      : [...action.permissions, permission],
                  })
                }
              />
              <BuilderToggleRow
                label="Ask approval on every call"
                description="Additional to the enable-time grant."
                checked={action.requiresApproval}
                onToggle={() =>
                  patchAction(action.id, { requiresApproval: !action.requiresApproval })
                }
              />
              <TextField
                label="Timeout (ms)"
                value={String(action.timeoutMs)}
                onChangeText={(value) => {
                  const parsed = Number(value);
                  if (Number.isFinite(parsed)) patchAction(action.id, { timeoutMs: parsed });
                }}
                keyboardType="number-pad"
              />
              <BuilderToggleRow
                label="Retryable on error"
                checked={action.errorHandling.retryable}
                onToggle={() =>
                  patchAction(action.id, {
                    errorHandling: {
                      ...action.errorHandling,
                      retryable: !action.errorHandling.retryable,
                    },
                  })
                }
              />
            </GlassView>
          ))}
          <Button label="Add another action" variant="secondary" onPress={addAction} />
        </View>
      )}
    </SettingsSection>
  );
}

function TestingStep({
  draft,
  testActionId,
  setTestActionId,
  testInput,
  setTestInput,
  testResult,
  testing,
  onRun,
  styles,
}: {
  draft: BuilderDraft;
  testActionId: string;
  setTestActionId: (value: string) => void;
  testInput: string;
  setTestInput: (value: string) => void;
  testResult: BuilderRunResult | null;
  testing: boolean;
  onRun: () => void;
  styles: StepStyles;
}) {
  const action = draft.actions.find((entry) => entry.id === testActionId) ?? null;

  return (
    <SettingsSection
      title="Testing Playground"
      description="Run a fixed sandbox program with fresh approval. Nothing is persisted as a grant."
    >
      <BuilderInfo>
        {Platform.OS === 'android'
          ? 'Sandbox execution is available on Android. Each run asks for approval again.'
          : 'Testing runs only on Android. On this platform the sandbox fails closed without executing anything.'}
      </BuilderInfo>
      <View style={styles.field}>
        <Text style={styles.label}>Action</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chips}>
            {draft.actions.map((entry) => {
              const selected = entry.id === testActionId;
              return (
                <Pressable
                  key={entry.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setTestActionId(entry.id)}
                  style={({ pressed }) => [
                    styles.chip,
                    selected && styles.chipSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                    {entry.name || entry.id}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </ScrollView>
      </View>
      <BuilderJsonField
        label="Test input (JSON)"
        value={testInput}
        onChange={setTestInput}
        hint={action ? `Expected fields: ${Object.keys(effectiveProperties(action)).join(', ') || 'none'}` : 'Add an action first.'}
        error={validateJsonHint(testInput)}
      />
      <Button
        label={testing ? 'Running…' : 'Run in sandbox'}
        onPress={onRun}
        loading={testing}
        disabled={!action || testing}
      />
      {testResult ? (
        <View style={[styles.resultCard, testResult.ok ? styles.resultOk : styles.resultError]}>
          <Text style={styles.resultTitle}>{testResult.ok ? 'Succeeded' : 'Failed'}</Text>
          <Text style={styles.resultMeta}>
            {testResult.durationMs} ms · {testResult.trace}
          </Text>
          {testResult.errors.map((message) => (
            <Text key={message} style={styles.resultErrorText}>
              {message}
            </Text>
          ))}
          <Text style={styles.resultLabel}>Output</Text>
          <Text style={styles.resultCode}>
            {JSON.stringify(testResult.output ?? null, null, 2)}
          </Text>
          {testResult.logs.length > 0 ? (
            <>
              <Text style={styles.resultLabel}>Logs</Text>
              {testResult.logs.map((line, index) => (
                <Text key={`${index}-${line}`} style={styles.resultLog}>
                  {line}
                </Text>
              ))}
            </>
          ) : null}
        </View>
      ) : null}
    </SettingsSection>
  );
}

function effectiveProperties(action: BuilderAction): Record<string, unknown> {
  const properties = action.inputSchema.properties;
  return properties && typeof properties === 'object' && !Array.isArray(properties)
    ? (properties as Record<string, unknown>)
    : {};
}

function SaveStep({
  draft,
  validation,
  previewText,
  installed,
  saving,
  onSave,
  onInstall,
  onExport,
  onPrepare,
  onHistory,
  styles,
}: {
  draft: BuilderDraft;
  validation: ReturnType<typeof validateAndBuild>;
  previewText: string;
  installed: boolean;
  saving: boolean;
  onSave: () => void;
  onInstall: () => void;
  onExport: () => void;
  onPrepare: () => void;
  onHistory: () => void;
  styles: StepStyles;
}) {
  const { colors } = useAppTheme();

  return (
    <>
      <SettingsSection
        title="Save & Install"
        description="Review the canonical manifest, save a draft, then install with explicit approval."
      >
        <BuilderFeedback validation={validation} />
        <View style={styles.saveRow}>
          <Button label="Save draft" variant="secondary" onPress={onSave} loading={saving} />
          <Button
            label={installed ? 'Update & reinstall' : 'Install plugin'}
            onPress={onInstall}
            disabled={!validation.ok || saving}
            loading={saving}
          />
        </View>
        <View style={styles.saveRow}>
          <Button label="Export manifest" variant="secondary" onPress={onExport} />
          <Button
            label={draft.preparedForPublish ? 'Ready for review' : 'Prepare to publish'}
            variant="ghost"
            onPress={onPrepare}
            disabled={!validation.ok}
          />
        </View>
        <BuilderInfo>
          Installing asks for explicit approval and never auto-grants permissions. Publishing
          is a separate reviewed process; this action only marks the draft locally.
        </BuilderInfo>
        <Pressable
          accessibilityRole="button"
          onPress={onHistory}
          disabled={!draft.pluginId}
          style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}
        >
          <Ionicons name="time-outline" size={15} color={colors.accent} />
          <Text style={styles.linkText}>View execution history & logs</Text>
        </Pressable>
      </SettingsSection>
      <SettingsSection
        title="Canonical manifest preview"
        description="Exactly what ORBIT validates and installs. Draft-only fields are excluded."
      >
        <ScrollView style={styles.previewScroll} nestedScrollEnabled>
          <Text style={styles.previewCode}>{previewText}</Text>
        </ScrollView>
      </SettingsSection>
    </>
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
    loadingWrap: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
    },
    loadingText: {
      color: colors.textMuted,
      ...typography.bodySmall,
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
    navigationRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    navButton: {
      flex: 1,
    },
    backLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      alignSelf: 'flex-start',
    },
    backLinkText: {
      color: colors.accent,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    linkButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      alignSelf: 'flex-start',
    },
    linkText: {
      color: colors.accent,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    footnote: {
      color: colors.textFaint,
      ...typography.caption,
      textAlign: 'center',
    },
    field: {
      gap: spacing.xs + 2,
    },
    label: {
      color: colors.textMuted,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    hint: {
      color: colors.textFaint,
      fontSize: 12,
      lineHeight: 17,
    },
    mutedText: {
      color: colors.textFaint,
      ...typography.caption,
    },
    count: {
      color: colors.textFaint,
      ...typography.caption,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.sm,
      paddingVertical: 2,
    },
    chip: {
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
      backgroundColor: colors.surfaceAlt,
    },
    chipSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    chipText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    chipTextSelected: {
      color: colors.accent,
    },
    pressed: {
      opacity: 0.78,
    },
    envRow: {
      gap: spacing.xs,
      padding: spacing.sm,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    envInput: {
      minHeight: layout.touchTarget - 4,
      borderRadius: radius.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      paddingHorizontal: spacing.sm,
    },
    removeButton: {
      minWidth: layout.iconButton,
      minHeight: layout.touchTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyInline: {
      gap: spacing.sm,
      paddingVertical: spacing.md,
    },
    emptyInlineText: {
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    list: {
      gap: spacing.sm,
    },
    actionCard: {
      gap: spacing.sm,
      padding: spacing.sm + 2,
      borderRadius: radius.lg,
    },
    actionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    actionTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    resultCard: {
      gap: spacing.xs + 2,
      borderRadius: radius.md,
      borderWidth: 1,
      padding: spacing.sm,
      marginTop: spacing.sm,
    },
    resultOk: {
      borderColor: colors.success,
      backgroundColor: colors.successSoft,
    },
    resultError: {
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
    },
    resultTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '700',
    },
    resultMeta: {
      color: colors.textMuted,
      ...typography.caption,
    },
    resultLabel: {
      color: colors.textMuted,
      ...typography.bodySmall,
      fontWeight: '600',
      marginTop: spacing.xs,
    },
    resultCode: {
      color: colors.text,
      fontFamily: 'monospace',
      fontSize: 12,
      lineHeight: 17,
    },
    resultErrorText: {
      color: colors.danger,
      ...typography.bodySmall,
    },
    resultLog: {
      color: colors.textMuted,
      fontFamily: 'monospace',
      fontSize: 11,
      lineHeight: 15,
    },
    saveRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    previewScroll: {
      maxHeight: 320,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      padding: spacing.sm,
    },
    previewCode: {
      color: colors.text,
      fontFamily: 'monospace',
      fontSize: 11,
      lineHeight: 16,
    },
  });
