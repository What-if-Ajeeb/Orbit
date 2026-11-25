import { useAppTheme, useStyles, type AppTheme, type ThemeMode } from '@/context/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SegmentedButtons, Switch } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormError } from '@/components/FormError';
import { GlassView } from '@/components/GlassView';
import { McpServersCard } from '@/components/McpServersCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SettingsNavRow } from '@/components/SettingsNavRow';
import { SettingsSection } from '@/components/SettingsSection';
import { SidebarButton } from '@/components/SidebarButton';
import { StatusPill, type StatusTone } from '@/components/StatusPill';
import { TextField } from '@/components/TextField';
import { useSession } from '@/context/auth';
import { usePluginSnapshot } from '@/context/plugins';
import { useSidebar } from '@/context/sidebar';
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
import { getChatStore } from '@/lib/chat';
import {
  getNotificationPermission,
  requestNotificationPermission,
  sendTestReminder,
  type NotificationPermissionState,
} from '@/lib/notifications';
import { fonts, layout, radius, spacing, typography } from '@/theme';


const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

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

export default function SettingsScreen() {
  const { colors, mode, setMode } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useSession();
  const snapshot = usePluginSnapshot();
  const { open: openSidebar } = useSidebar();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionState>('undetermined');
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
            ? `Ollama reachable with ${models.length} installed model${models.length === 1 ? '' : 's'}.`
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
        const [nextSettings, nextPermission] = await Promise.all([
          loadAiSettings(),
          getNotificationPermission(),
        ]);

        if (active) {
          setSettings(nextSettings);
          setPermission(nextPermission);

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
        }
      })();

      return () => {
        active = false;
        discoveryRef.current?.abort();
      };
    }, [discoverOllamaModels])
  );

  if (!user) {
    return null;
  }

  if (!settings) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const activeUser = user;
  const currentSettings = settings;
  const preset = PROVIDER_PRESETS[currentSettings.provider];
  const aiReady = isAiConfigured(settings);
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
    const model =
      currentSettings.model.trim() ||
      (currentSettings.provider === 'ollama' ? ollamaModels[0]?.name ?? '' : '');

    if (!baseUrl || !model) {
      setError('Base URL and model are both required.');
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
          ? `Ollama is reachable. ${result.models.length} installed model${result.models.length === 1 ? '' : 's'} found.`
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

  async function enableNotifications() {
    const granted = await requestNotificationPermission();
    const nextPermission = await getNotificationPermission();
    setPermission(nextPermission);

    if (granted) {
      setNotice('Notifications enabled. You will be reminded 15 minutes before a task is due.');
    } else {
      setError('Notifications are not allowed. Enable them in system settings.');
    }
  }

  async function testReminder() {
    const sent = await sendTestReminder();
    setPermission(await getNotificationPermission());

    if (sent) {
      setNotice('Test reminder scheduled. It should arrive in about 3 seconds.');
    } else {
      setError('Could not send a test reminder. Check notification permission.');
    }
  }

  function confirmClearChat() {
    Alert.alert('Clear chat history?', 'Your tasks and reminders will not be deleted.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await getChatStore(db).clearAllChat(activeUser.id);
            setNotice('Chat history cleared.');
          })();
        },
      },
    ]);
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'Your local account stays on this device.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await signOut();
          })();
        },
      },
    ]);
  }

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.lg * 2,
          },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="SETTINGS"
          title="Settings"
          subtitle="Appearance, AI access, integrations, security and account."
          left={<SidebarButton onPress={openSidebar} />}
        />

        {error ? (
          <View style={styles.bannerWrap}>
            <FormError message={error} />
          </View>
        ) : null}

        {notice ? (
          <View style={styles.notice}>
            <Ionicons name="checkmark-circle" size={16} color={colors.success} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        <SettingsSection
          title="Appearance"
          description="Choose how ORBIT looks on this device."
        >
          <GlassView style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingIconWrap}>
                <Ionicons name="color-palette-outline" size={18} color={colors.accent} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Color mode</Text>
                <Text style={styles.settingDescription}>
                  Use light, dark, or follow your device setting.
                </Text>
              </View>
            </View>
            <SegmentedButtons
              value={mode}
              onValueChange={(value) => setMode(value as ThemeMode)}
              density="medium"
              buttons={THEME_OPTIONS.map((option) => ({
                value: option.id,
                label: option.label,
                icon:
                  option.id === 'light'
                    ? 'weather-sunny'
                    : option.id === 'dark'
                      ? 'weather-night'
                      : 'theme-light-dark',
              }))}
            />
          </GlassView>
        </SettingsSection>

        <SettingsSection
          title="AI Connection"
          description="Saved provider details and live connection health are shown separately."
          action={
            <StatusPill
              label={aiReady ? 'Configured' : 'Not configured'}
              tone={aiReady ? 'success' : 'neutral'}
              showDot
            />
          }
        >
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

            <View style={styles.settingRow}>
              <View style={[styles.settingIconWrap, { backgroundColor: colors.accentSoft }]}>
                <Ionicons
                  name={isLocalAi ? 'server-outline' : 'cloud-outline'}
                  size={18}
                  color={colors.accent}
                />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>
                  {isLocalAi ? 'Local server' : 'Cloud provider'}
                </Text>
                <Text style={styles.settingDescription}>
                  {isOllamaLocal
                    ? 'Discover installed models from Ollama running on this device.'
                    : isLocalAi
                      ? 'Connect to an OpenAI-compatible server on your network.'
                      : 'Bring your own API key. ORBIT does not run a shared server.'}
                </Text>
              </View>
            </View>

            <SegmentedButtons
              value={currentSettings.mode}
              onValueChange={(value) => selectMode(value as AiConnectionMode)}
              density="medium"
              buttons={[
                { value: 'cloud', label: 'Cloud', icon: 'cloud-outline' },
                { value: 'local', label: 'Local server', icon: 'server-outline' },
              ]}
            />

            <View style={styles.divider} />

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
              <Ionicons name="information-circle-outline" size={16} color={colors.textMuted} />
              <Text style={styles.infoBoxText}>{preset.note}</Text>
            </View>

            {preset.docsUrl ? (
              <Pressable
                accessibilityRole="link"
                onPress={() => {
                  void Linking.openURL(preset.docsUrl);
                }}
                style={styles.docsLink}
              >
                <Text style={styles.docsLinkText}>
                  {isLocalAi ? 'Ollama setup guide' : 'Get an API key'}
                </Text>
                <Ionicons name="open-outline" size={14} color={colors.accent} />
              </Pressable>
            ) : null}

            {isOllamaLocal ? (
              <View style={[styles.infoBox, styles.infoBoxAccent]}>
                <Ionicons name="wifi-outline" size={16} color={colors.accent} />
                <Text style={styles.infoBoxText}>
                  Native API base URL:{' '}
                  <Text style={styles.infoCode}>http://127.0.0.1:11434</Text> — no{' '}
                  <Text style={styles.infoCode}>/v1</Text>. Plain HTTP is allowed only for this
                  loopback address. Do not expose Ollama on your LAN or the public internet.
                </Text>
              </View>
            ) : null}

            {isOllamaLocal ? (
              <View style={styles.discoveryBox}>
                {discoveryStatus === 'loading' ? (
                  <ActivityIndicator size="small" color={colors.accent} />
                ) : (
                  <Ionicons
                    name={
                      discoveryStatus === 'success'
                        ? 'checkmark-circle'
                        : discoveryStatus === 'error'
                          ? 'alert-circle'
                          : 'radio-outline'
                    }
                    size={18}
                    color={
                      discoveryStatus === 'success'
                        ? colors.success
                        : discoveryStatus === 'error'
                          ? colors.danger
                          : colors.textMuted
                    }
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
                  <Ionicons name="refresh-outline" size={18} color={colors.accent} />
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

            <Button
              label="Connect on-device Ollama"
              variant="secondary"
              onPress={() => {
                void connectOnDeviceOllama();
              }}
              loading={isSaving}
              disabled={isTesting || discoveryStatus === 'loading'}
            />

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
              <TextField
                label="Model"
                value={currentSettings.model}
                onChangeText={(value) => update({ model: value })}
                placeholder={
                  isOllamaLocal ? 'Select a discovered model' : preset.model || 'model-name'
                }
                autoCapitalize="none"
                autoCorrect={false}
                hint={
                  isOllamaLocal
                    ? 'Pick an installed model above, or enter one that is pulled in Ollama.'
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
                onPress={confirmRemoveKey}
                style={styles.removeKey}
              >
                <Ionicons name="trash-outline" size={14} color={colors.danger} />
                <Text style={styles.removeKeyText}>Remove API key</Text>
              </Pressable>
            ) : null}

            <View style={styles.securityRow}>
              <Ionicons name="shield-checkmark-outline" size={14} color={colors.textFaint} />
              <Text style={styles.securityNote}>
                {isLocalAi
                  ? 'Chat messages go to your local server. Tasks, account data, and keys stay on this device.'
                  : 'Chat messages go to your selected provider. Tasks, account data, and keys stay on this device.'}
              </Text>
            </View>
          </GlassView>
        </SettingsSection>

        <SettingsSection
          title="MCP integrations"
          description="Connect external tools. Server results are treated as untrusted data."
        >
          <McpServersCard onNotice={setNotice} onError={setError} />
        </SettingsSection>

        <SettingsSection
          title="Plugins"
          description="Installed plugins, contributed settings and permission reviews."
        >
          <SettingsNavRow
            icon="extension-puzzle-outline"
            title="Plugin Manager"
            description="Install, enable and review plugin permissions."
            badge={`${snapshot.stats.installed} installed`}
            onPress={() => router.push('/plugins' as Href)}
          />
          {snapshot.settingsSections.map((section) => (
            <SettingsNavRow
              key={`${section.pluginId}:${section.id}`}
              icon="options-outline"
              title={section.title}
              description={section.description ?? `Contributed by ${section.pluginName}.`}
              onPress={() => router.push(section.path as Href)}
            />
          ))}
        </SettingsSection>

        <SettingsSection
          title="Security"
          description="Approvals, saved grants and paired computers are managed here."
        >
          <SettingsNavRow
            icon="shield-checkmark-outline"
            title="Agent permissions"
            description="Active grants, pending approvals, activity and emergency stop."
            onPress={() => router.push('/permissions' as Href)}
          />
          <SettingsNavRow
            icon="checkmark-done-outline"
            title="Approval history"
            description="Review past agent permission decisions and denials."
            onPress={() => router.push('/approvals' as Href)}
          />
          <SettingsNavRow
            icon="key-outline"
            title="Saved permission grants"
            description="Review tool allowlists and revoke saved choices."
            onPress={() => router.push('/tool-permissions' as Href)}
          />
        </SettingsSection>

        <SettingsSection
          title="Reminders"
          description="Control notification access and test reminder delivery."
        >
          <GlassView style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingIconWrap}>
                <Ionicons name="notifications-outline" size={18} color={colors.accent} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Notifications</Text>
                <Text style={styles.settingDescription}>
                  Get alerted 15 minutes before a task is due.
                </Text>
              </View>
            </View>
            <View style={styles.switchRow}>
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>
                  {permission === 'granted' ? 'Notifications enabled' : 'Enable notifications'}
                </Text>
                <Text style={styles.settingDescription}>
                  {permission === 'denied'
                    ? 'Permission denied in system settings.'
                    : 'Allow ORBIT to send reminder notifications.'}
                </Text>
              </View>
              <Switch
                value={permission === 'granted'}
                disabled={permission === 'granted'}
                onValueChange={(value) => {
                  if (value) void enableNotifications();
                }}
              />
            </View>
            {permission === 'granted' ? (
              <Button
                label="Send test reminder"
                variant="secondary"
                onPress={() => {
                  void testReminder();
                }}
              />
            ) : null}
          </GlassView>
        </SettingsSection>

        <SettingsSection title="Account" description="Signed-in identity for this device.">
          <GlassView style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.profileAvatar}>
                <Ionicons name="person" size={20} color={colors.accent} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>{activeUser.name}</Text>
                <Text style={styles.settingDescription}>{activeUser.email}</Text>
              </View>
            </View>
            <Button label="Sign out" variant="danger" onPress={confirmSignOut} />
          </GlassView>
        </SettingsSection>

        <SettingsSection
          title="Data"
          description="Local chat history can be cleared without touching tasks."
        >
          <GlassView style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingIconWrap}>
                <Ionicons name="chatbubbles-outline" size={18} color={colors.accent} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Chat history</Text>
                <Text style={styles.settingDescription}>
                  Clear agent conversations. Tasks and reminders are not affected.
                </Text>
              </View>
            </View>
            <Button
              label="Clear chat history"
              variant="secondary"
              onPress={confirmClearChat}
            />
          </GlassView>
        </SettingsSection>

        <Text style={styles.footer}>
          Orbit v{Constants.expoConfig?.version ?? '1.10.6'} · local-first · Android
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
    loading: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: {
      flexGrow: 1,
      maxWidth: layout.contentMaxWidth,
      width: '100%',
      alignSelf: 'center',
      paddingHorizontal: layout.gutter,
      gap: spacing.lg,
    },
    bannerWrap: {
      marginTop: spacing.sm,
    },
    notice: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      backgroundColor: colors.successSoft,
      borderWidth: 1,
      borderColor: `${colors.success}47`,
      borderRadius: radius.md,
      paddingVertical: spacing.sm + 2,
      paddingHorizontal: spacing.md,
    },
    noticeText: {
      flex: 1,
      color: colors.success,
      ...typography.bodySmall,
    },
    card: {
      padding: spacing.md,
      gap: spacing.md,
    },
    settingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    settingIconWrap: {
      width: 40,
      height: 40,
      borderRadius: radius.sm,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    settingText: {
      flex: 1,
      gap: 2,
    },
    settingTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    settingDescription: {
      color: colors.textMuted,
      ...typography.bodySmall,
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
      height: 1,
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
    fields: {
      gap: spacing.md,
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
      gap: 6,
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
      borderTopWidth: 1,
      borderTopColor: colors.border,
      paddingTop: spacing.md,
    },
    securityNote: {
      flex: 1,
      color: colors.textFaint,
      ...typography.caption,
    },
    switchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    profileAvatar: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    footer: {
      color: colors.textFaint,
      ...typography.caption,
      textAlign: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    pressed: {
      opacity: 0.8,
    },
  });
