import { router, useFocusEffect, type Href } from 'expo-router';
import {
  ChevronRight,
  Cloud,
  Cpu,
  ExternalLink,
  RefreshCw,
  Server,
  ShieldCheck,
} from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SegmentedButtons } from 'react-native-paper';

import { Button } from '@/components/Button';
import { GlassView } from '@/components/GlassView';
import { SettingsFeedback } from '@/components/settings/SettingsFeedback';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsScreen } from '@/components/settings/SettingsScreen';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
import { TextField } from '@/components/TextField';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  listOllamaModels,
  OLLAMA_DISCOVERY_TIMEOUT_MS,
  type OllamaModel,
} from '@/lib/ai/ollama';
import { pingAi } from '@/lib/ai/providers';
import {
  applyConnectionMode,
  applyProviderPreset,
  CLOUD_PROVIDER_ORDER,
  isAiConfigured,
  loadAiSettings,
  LOCAL_PROVIDER_ORDER,
  onDeviceOllamaSettings,
  PROVIDER_PRESETS,
  saveAiSettings,
  type AiConnectionMode,
  type AiProvider,
  type AiSettings,
} from '@/lib/ai/settings';
import { fonts, layout, radius, spacing, typography } from '@/theme';

type DiscoveryStatus = 'idle' | 'loading' | 'success' | 'error';
type DiscoveryResult = { models: OllamaModel[]; selectedModel: string };
type ConnectionHealth =
  | 'unknown'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'unreachable'
  | 'error';

const CONNECTION_LABELS: Record<ConnectionHealth, string> = {
  unknown: 'Not checked',
  connecting: 'Connecting',
  connected: 'Connected',
  disconnected: 'Disconnected',
  unreachable: 'Unreachable',
  error: 'Error',
};

const CONNECTION_TONES: Record<ConnectionHealth, StatusTone> = {
  unknown: 'neutral',
  connecting: 'info',
  connected: 'success',
  disconnected: 'warning',
  unreachable: 'danger',
  error: 'danger',
};

export default function AiConnectionSettingsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([]);
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryStatus>('idle');
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [connectionHealth, setConnectionHealth] = useState<ConnectionHealth>('unknown');
  const [connectionDetail, setConnectionDetail] = useState<string | null>(
    'Configuration saved. Run a connection test to verify live access.'
  );
  const discoveryRef = useRef<AbortController | null>(null);

  function markConnectionUnchecked() {
    setConnectionHealth('unknown');
    setConnectionDetail('Configuration changed. Test the connection to verify it.');
  }

  const discoverOllamaModels = useCallback(
    async (target: AiSettings, autoSelect = false): Promise<DiscoveryResult | null> => {
      discoveryRef.current?.abort();
      const controller = new AbortController();
      discoveryRef.current = controller;
      setDiscoveryStatus('loading');
      setDiscoveryError(null);
      setConnectionHealth('connecting');
      setConnectionDetail('Checking the Ollama server on this device…');

      try {
        const models = await listOllamaModels(target.baseUrl, {
          signal: controller.signal,
          timeoutMs: OLLAMA_DISCOVERY_TIMEOUT_MS,
          retries: 1,
        });
        const selectedModel =
          models.find((model) => model.name === target.model)?.name ?? models[0]?.name ?? '';

        setOllamaModels(models);
        setDiscoveryStatus('success');
        setConnectionHealth(models.length > 0 ? 'connected' : 'error');
        setConnectionDetail(
          models.length > 0
            ? `Ollama reachable with ${models.length} installed model${
                models.length === 1 ? '' : 's'
              }.`
            : 'Ollama is reachable, but no models are installed. Pull a model and retry.'
        );

        if (autoSelect && selectedModel && selectedModel !== target.model) {
          const saved = await saveAiSettings({
            ...target,
            provider: 'ollama',
            mode: 'local',
            model: selectedModel,
          });
          setSettings(saved);
        }

        return { models, selectedModel };
      } catch (discoverError) {
        if (controller.signal.aborted) {
          return null;
        }

        setOllamaModels([]);
        setDiscoveryStatus('error');
        const message =
          discoverError instanceof Error
            ? discoverError.message
            : 'Could not reach Ollama. Check that the app is running on this device.';
        setDiscoveryError(message);
        setConnectionHealth('unreachable');
        setConnectionDetail(message);
        return null;
      } finally {
        if (discoveryRef.current === controller) {
          discoveryRef.current = null;
        }
      }
    },
    []
  );

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void (async () => {
        const nextSettings = await loadAiSettings();

        if (!active) {
          return;
        }

        setSettings(nextSettings);

        if (nextSettings.provider === 'ollama' && nextSettings.mode === 'local') {
          void discoverOllamaModels(nextSettings);
        } else {
          discoveryRef.current?.abort();
          setOllamaModels([]);
          setDiscoveryStatus('idle');
          setDiscoveryError(null);

          if (isAiConfigured(nextSettings)) {
            setConnectionHealth('unknown');
            setConnectionDetail(
              'Configuration saved. Run a connection test to verify live access.'
            );
          } else {
            setConnectionHealth('disconnected');
            setConnectionDetail('Add provider details before testing the connection.');
          }
        }
      })();

      return () => {
        active = false;
        discoveryRef.current?.abort();
      };
    }, [discoverOllamaModels])
  );

  if (!settings) {
    return <SettingsScreen title="AI Connection" loading />;
  }

  const currentSettings = settings;
  const preset = PROVIDER_PRESETS[currentSettings.provider];
  const aiReady = isAiConfigured(currentSettings);
  const isLocalAi = currentSettings.mode === 'local';
  const isOllamaLocal = isLocalAi && currentSettings.provider === 'ollama';
  const providerOrder = isLocalAi ? LOCAL_PROVIDER_ORDER : CLOUD_PROVIDER_ORDER;
  const discoveryTitle =
    discoveryStatus === 'loading'
      ? 'Discovering Ollama models…'
      : discoveryStatus === 'success'
        ? `Ollama reachable · ${ollamaModels.length} model${ollamaModels.length === 1 ? '' : 's'}`
        : discoveryStatus === 'error'
          ? 'Ollama unreachable'
          : 'Ollama not checked yet';
  const discoveryDetail =
    discoveryStatus === 'error'
      ? discoveryError ?? 'Could not reach the native Ollama API.'
      : discoveryStatus === 'success' && ollamaModels.length === 0
        ? 'Server is reachable, but no models are installed yet. Pull one in Ollama and retry.'
        : isOllamaLocal
          ? 'Models are discovered from GET /api/tags on this device.'
          : '';

  function update(patch: Partial<AiSettings>) {
    setNotice(null);
    setError(null);
    markConnectionUnchecked();

    if (patch.baseUrl !== undefined) {
      discoveryRef.current?.abort();
      setOllamaModels([]);
      setDiscoveryStatus('idle');
      setDiscoveryError(null);
    }

    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  function selectProvider(provider: AiProvider) {
    setNotice(null);
    setError(null);
    markConnectionUnchecked();
    setOllamaModels([]);
    setDiscoveryStatus('idle');
    setDiscoveryError(null);
    setSettings((current) => (current ? applyProviderPreset(current, provider) : current));
  }

  function selectMode(mode: AiConnectionMode) {
    setNotice(null);
    setError(null);
    markConnectionUnchecked();
    setOllamaModels([]);
    setDiscoveryStatus('idle');
    setDiscoveryError(null);
    setSettings((current) => (current ? applyConnectionMode(current, mode) : current));
  }

  async function persist(showNotice: boolean): Promise<AiSettings | null> {
    const baseUrl = currentSettings.baseUrl.trim();
    const apiKey = currentSettings.apiKey.trim();
    const fallbackModel =
      currentSettings.provider === 'ollama'
        ? ollamaModels[0]?.name ?? ''
        : isLocalAi
          ? ''
          : preset.model;
    const model = currentSettings.model.trim() || fallbackModel;

    if (!baseUrl || !model) {
      setError(
        'Base URL and model are both required. Choose a model in Model Preferences, then save.'
      );
      return null;
    }

    if (currentSettings.mode === 'local' && !/^https?:\/\//i.test(baseUrl)) {
      setError('Local server URL must start with http:// or https://.');
      return null;
    }

    setIsSaving(true);
    setError(null);

    try {
      const saved = await saveAiSettings({ ...currentSettings, baseUrl, model, apiKey });
      setSettings(saved);

      if (showNotice) {
        setNotice(
          saved.mode === 'local'
            ? 'Local AI server saved. The agent will use it for chat.'
            : 'AI settings saved. The agent now runs in full AI mode.'
        );
        setConnectionHealth('unknown');
        setConnectionDetail('Settings saved. Test the connection to verify live access.');
      }

      return saved;
    } catch {
      setError('Could not save settings. Please try again.');
      return null;
    } finally {
      setIsSaving(false);
    }
  }

  async function testConnection() {
    if (isTesting || isSaving) {
      return;
    }

    setError(null);
    setIsTesting(true);

    if (currentSettings.provider === 'ollama' && currentSettings.mode === 'local') {
      const result = await discoverOllamaModels(currentSettings);

      setIsTesting(false);

      if (!result) {
        return;
      }

      setNotice(
        result.models.length > 0
          ? `Ollama is reachable. ${result.models.length} installed model${
              result.models.length === 1 ? '' : 's'
            } found.`
          : 'Ollama is reachable, but no models are installed. Pull a model in Ollama, then retry.'
      );
      return;
    }

    try {
      const saved = await persist(false);

      if (!saved) {
        setConnectionHealth('error');
        setConnectionDetail('Fix the highlighted settings, then try again.');
        return;
      }

      if (!isAiConfigured(saved)) {
        const message =
          saved.mode === 'local'
            ? 'Add a valid local server URL and model to run the test.'
            : 'Add an API key to run the test.';
        setError(message);
        setConnectionHealth('disconnected');
        setConnectionDetail(message);
        return;
      }

      setConnectionHealth('connecting');
      setConnectionDetail('Testing the provider connection…');
      const reply = await pingAi(saved);
      setConnectionHealth('connected');
      setConnectionDetail(`Provider replied: ${reply.slice(0, 80)}`);
      setNotice('Connection successful. The provider responded to a live test request.');
    } catch (testError) {
      const message =
        testError instanceof Error
          ? testError.message
          : 'Connection test failed. Check your settings.';
      setError(message);
      setConnectionHealth('unreachable');
      setConnectionDetail(message);
    } finally {
      setIsTesting(false);
    }
  }

  async function connectOnDeviceOllama() {
    if (isSaving || isTesting) {
      return;
    }

    setIsSaving(true);
    setError(null);
    setNotice(null);

    try {
      const target = onDeviceOllamaSettings();
      const saved = await saveAiSettings(target);
      setSettings(saved);
      const result = await discoverOllamaModels(saved, true);

      if (!result) {
        return;
      }

      if (result.models.length === 0) {
        setError(
          'Ollama is reachable but no models are installed. Pull a model in Ollama, then tap Retry.'
        );
        setConnectionHealth('error');
        setConnectionDetail('Server reachable; no installed models are available to chat.');
        return;
      }

      setNotice(`Connected to on-device Ollama with ${result.selectedModel}.`);
    } catch {
      setError('Could not save the on-device Ollama settings. Please try again.');
    } finally {
      setIsSaving(false);
    }
  }

  function confirmRemoveKey() {
    Alert.alert('Remove API key?', 'The agent will switch to local mode. Your tasks stay safe.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              const saved = await saveAiSettings({ ...currentSettings, apiKey: '' });
              setSettings(saved);
              setNotice('API key removed. The agent switched to local mode.');
            } catch {
              setError('Could not remove the key.');
            }
          })();
        },
      },
    ]);
  }

  return (
    <SettingsScreen
      title="AI Connection"
      subtitle="Connect a cloud provider or a server on your device. ORBIT never runs a shared AI proxy."
    >
      <SettingsFeedback
        error={error}
        notice={notice}
        onDismissError={() => setError(null)}
      />

      <GlassView style={styles.card}>
        <View style={styles.statusRow}>
          <StatusPill
            label={`Live: ${CONNECTION_LABELS[connectionHealth]}`}
            tone={CONNECTION_TONES[connectionHealth]}
            showDot
          />
          <Text style={styles.statusDetail}>
            {connectionDetail ??
              (aiReady
                ? 'Run a connection test to verify live access.'
                : 'Add provider details before testing the connection.')}
          </Text>
        </View>

        <View style={styles.divider} />

        <Text style={styles.fieldLabel}>Connection type</Text>
        <SegmentedButtons
          value={currentSettings.mode}
          onValueChange={(value) => selectMode(value as AiConnectionMode)}
          density="medium"
          buttons={[
            { value: 'cloud', label: 'Cloud', icon: 'cloud-outline' },
            { value: 'local', label: 'Local server', icon: 'server-outline' },
          ]}
        />

        <Text style={styles.fieldLabel}>Provider</Text>
        <View style={styles.providerRow}>
          {providerOrder.map((provider) => {
            const active = currentSettings.provider === provider;

            return (
              <Pressable
                key={provider}
                accessibilityRole="button"
                accessibilityLabel={`${PROVIDER_PRESETS[provider].label} provider`}
                accessibilityState={{ selected: active }}
                onPress={() => selectProvider(provider)}
                style={[styles.providerChip, active && styles.providerChipActive]}
              >
                <Text style={[styles.providerText, active && styles.providerTextActive]}>
                  {PROVIDER_PRESETS[provider].shortLabel}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoBoxText}>{preset.note}</Text>
        </View>

        {preset.docsUrl ? (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={isLocalAi ? 'Open Ollama setup guide' : 'Open provider API key page'}
            onPress={() => {
              void Linking.openURL(preset.docsUrl);
            }}
            style={styles.docsLink}
          >
            <Text style={styles.docsLinkText}>
              {isLocalAi ? 'Ollama setup guide' : 'Get an API key'}
            </Text>
            <ExternalLink size={14} color={colors.accent} strokeWidth={2} />
          </Pressable>
        ) : null}

        <View style={styles.fields}>
          <TextField
            label={isLocalAi ? 'Server URL' : 'Base URL'}
            value={currentSettings.baseUrl}
            onChangeText={(value) => update({ baseUrl: value })}
            placeholder={
              isOllamaLocal
                ? 'http://127.0.0.1:11434'
                : isLocalAi
                  ? 'http://192.168.1.10:11434'
                  : 'https://api.openai.com/v1'
            }
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            hint={
              isOllamaLocal
                ? 'Native Ollama API URL. The /v1 suffix is removed automatically.'
                : isLocalAi
                  ? 'Include http:// or https://, host IP, and port.'
                  : undefined
            }
          />
          {!isLocalAi ? (
            <TextField
              label="API key"
              value={currentSettings.apiKey}
              onChangeText={(value) => update({ apiKey: value })}
              placeholder={preset.keyHint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              hint="Stored encrypted on this device."
            />
          ) : null}
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Chat model: ${currentSettings.model || 'not selected'}`}
          accessibilityHint="Opens model preferences"
          onPress={() => router.push('/settings/models' as Href)}
          style={({ pressed }) => [styles.modelRow, pressed && styles.pressed]}
        >
          <View style={styles.modelIcon}>
            <Cpu size={18} color={colors.accent} strokeWidth={2} />
          </View>
          <View style={styles.modelCopy}>
            <Text style={styles.modelTitle}>Chat model</Text>
            <Text numberOfLines={1} style={styles.modelValue}>
              {currentSettings.model || 'Not selected'}
            </Text>
          </View>
          <ChevronRight size={17} color={colors.textFaint} strokeWidth={2} />
        </Pressable>

        {isOllamaLocal ? (
          <View style={[styles.infoBox, styles.infoBoxAccent]}>
            <Text style={styles.infoBoxText}>
              Native API base URL: <Text style={styles.infoCode}>http://127.0.0.1:11434</Text> — no{' '}
              <Text style={styles.infoCode}>/v1</Text>. Plain HTTP is allowed only for this loopback
              address. Do not expose Ollama on your LAN or the public internet.
            </Text>
          </View>
        ) : null}

        {isOllamaLocal ? (
          <View style={styles.discoveryBox}>
            {discoveryStatus === 'loading' ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor:
                      discoveryStatus === 'success'
                        ? colors.success
                        : discoveryStatus === 'error'
                          ? colors.danger
                          : colors.textFaint,
                  },
                ]}
              />
            )}
            <View style={styles.discoveryText}>
              <Text style={styles.discoveryTitle}>{discoveryTitle}</Text>
              {discoveryDetail ? (
                <Text style={styles.discoveryDetail}>{discoveryDetail}</Text>
              ) : null}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Retry Ollama model discovery"
              disabled={discoveryStatus === 'loading'}
              onPress={() => {
                void discoverOllamaModels(currentSettings);
              }}
              style={({ pressed }) => [styles.retryButton, pressed && styles.pressed]}
            >
              <RefreshCw size={17} color={colors.accent} strokeWidth={2} />
            </Pressable>
          </View>
        ) : null}

        {isOllamaLocal && ollamaModels.length > 0 ? (
          <View>
            <Text style={styles.fieldLabel}>Installed models</Text>
            <View style={styles.providerRow}>
              {ollamaModels.map((model) => {
                const active = currentSettings.model === model.name;

                return (
                  <Pressable
                    key={model.name}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${model.name}`}
                    accessibilityState={{ selected: active }}
                    onPress={() => update({ model: model.name })}
                    style={[styles.modelChip, active && styles.providerChipActive]}
                  >
                    <Text style={[styles.providerText, active && styles.providerTextActive]}>
                      {model.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ) : null}

        {isLocalAi ? (
          <Button
            label="Connect on-device Ollama"
            variant="secondary"
            onPress={() => {
              void connectOnDeviceOllama();
            }}
            loading={isSaving}
            disabled={isTesting || discoveryStatus === 'loading'}
          />
        ) : null}

        <View style={styles.buttonRow}>
          <Button
            label="Test connection"
            variant="secondary"
            onPress={() => {
              void testConnection();
            }}
            loading={isTesting}
            disabled={isSaving}
            style={styles.flexButton}
          />
          <Button
            label="Save changes"
            onPress={() => {
              void persist(true);
            }}
            loading={isSaving}
            disabled={isTesting}
            style={styles.flexButton}
          />
        </View>

        {!isLocalAi && currentSettings.apiKey ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove API key"
            onPress={confirmRemoveKey}
            style={styles.removeKey}
          >
            <Text style={styles.removeKeyText}>Remove API key</Text>
          </Pressable>
        ) : null}

        <View style={styles.securityRow}>
          <ShieldCheck size={14} color={colors.textFaint} strokeWidth={2} />
          <Text style={styles.securityNote}>
            {isLocalAi
              ? 'Chat messages go to your local server. Tasks, account data, and keys stay on this device.'
              : 'Chat messages go to your selected provider. Tasks, account data, and keys stay on this device.'}
          </Text>
        </View>
      </GlassView>

      <SettingsGroup
        title="Model"
        footer="The selected model is used for agent chat and tool calls."
      >
        <SettingsRow
          icon={Cpu}
          title="Model Preferences"
          description={
            currentSettings.model
              ? 'Change or review the model used for this connection.'
              : 'Choose a model before testing or saving the connection.'
          }
          value={currentSettings.model || 'Not set'}
          onPress={() => router.push('/settings/models' as Href)}
        />
      </SettingsGroup>

      <View style={styles.providerSummary}>
        {isLocalAi ? (
          <Server size={16} color={colors.textMuted} strokeWidth={2} />
        ) : (
          <Cloud size={16} color={colors.textMuted} strokeWidth={2} />
        )}
        <Text style={styles.providerSummaryText}>
          {isLocalAi ? 'Local server' : 'Cloud provider'} · {preset.label}
          {currentSettings.model ? ` · ${currentSettings.model}` : ''}
        </Text>
      </View>
    </SettingsScreen>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    card: {
      padding: spacing.md,
      gap: spacing.md,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    statusDetail: {
      flex: 1,
      color: colors.textMuted,
      ...typography.caption,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
    },
    fieldLabel: {
      color: colors.text,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    providerRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    providerChip: {
      minHeight: layout.touchTarget,
      justifyContent: 'center',
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: 8,
    },
    providerChipActive: {
      borderColor: colors.borderFocus,
      backgroundColor: colors.accentSoft,
    },
    providerText: {
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    providerTextActive: {
      color: colors.accent,
      fontWeight: '600',
    },
    infoBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      padding: spacing.sm + 2,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
    },
    infoBoxAccent: {
      backgroundColor: colors.accentSoft,
    },
    infoBoxText: {
      flex: 1,
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    infoCode: {
      color: colors.text,
      fontFamily: fonts.mono,
      ...typography.code,
    },
    docsLink: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingVertical: 4,
    },
    docsLinkText: {
      color: colors.accent,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    fields: {
      gap: spacing.md,
    },
    modelRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      padding: spacing.sm + 2,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      minHeight: layout.touchTarget + 4,
    },
    modelIcon: {
      width: 32,
      height: 32,
      borderRadius: radius.sm - 3,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    modelCopy: {
      flex: 1,
      gap: 1,
    },
    modelTitle: {
      color: colors.text,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    modelValue: {
      color: colors.textMuted,
      ...typography.caption,
    },
    discoveryBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      padding: spacing.sm + 2,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    statusDot: {
      width: 9,
      height: 9,
      borderRadius: 5,
      marginHorizontal: 4,
    },
    discoveryText: {
      flex: 1,
      gap: 2,
    },
    discoveryTitle: {
      color: colors.text,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    discoveryDetail: {
      color: colors.textMuted,
      ...typography.caption,
    },
    retryButton: {
      width: layout.iconButton,
      height: layout.iconButton,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    modelChip: {
      minHeight: layout.iconButton,
      justifyContent: 'center',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      paddingHorizontal: spacing.md,
      paddingVertical: 6,
    },
    buttonRow: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    flexButton: {
      flex: 1,
    },
    removeKey: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: layout.touchTarget,
    },
    removeKeyText: {
      color: colors.danger,
      ...typography.bodySmall,
      fontWeight: '600',
    },
    securityRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.md,
    },
    securityNote: {
      flex: 1,
      color: colors.textFaint,
      ...typography.caption,
    },
    pressed: {
      opacity: 0.8,
    },
    providerSummary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs,
      paddingHorizontal: spacing.md,
    },
    providerSummaryText: {
      color: colors.textFaint,
      ...typography.caption,
      textAlign: 'center',
    },
  });
