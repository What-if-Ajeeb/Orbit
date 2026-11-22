import { useAppTheme, useStyles, type AppTheme, type ThemeMode } from '@/context/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { router, useFocusEffect, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
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
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { McpServersCard } from '@/components/McpServersCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { TextField } from '@/components/TextField';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { pingAi } from '@/lib/ai/providers';
import {
  applyConnectionMode,
  applyProviderPreset,
  CLOUD_PROVIDER_ORDER,
  isAiConfigured,
  loadAiSettings,
  LOCAL_PROVIDER_ORDER,
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
import { radius, spacing } from '@/theme';


const THEME_OPTIONS: { id: ThemeMode; label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
];

export default function SettingsScreen() {
  const { colors, mode, setMode } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useSession();
  const { open: openSidebar } = useSidebar();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionState>('undetermined');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
        }
      })();

      return () => {
        active = false;
      };
    }, [])
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
  const providerOrder = isLocalAi ? LOCAL_PROVIDER_ORDER : CLOUD_PROVIDER_ORDER;

  function update(patch: Partial<AiSettings>) {
    setNotice(null);
    setError(null);
    setSettings((current) => (current ? { ...current, ...patch } : current));
  }

  function selectProvider(provider: AiProvider) {
    setNotice(null);
    setError(null);
    setSettings((current) => (current ? applyProviderPreset(current, provider) : current));
  }

  function selectMode(mode: AiConnectionMode) {
    setNotice(null);
    setError(null);
    setSettings((current) => (current ? applyConnectionMode(current, mode) : current));
  }

  async function persist(showNotice: boolean): Promise<AiSettings | null> {
    const baseUrl = currentSettings.baseUrl.trim();
    const model = currentSettings.model.trim();
    const apiKey = currentSettings.apiKey.trim();

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
    if (isTesting) {
      return;
    }

    const saved = await persist(false);

    if (!saved) {
      return;
    }

    if (!isAiConfigured(saved)) {
      setError(
        saved.mode === 'local'
          ? 'Add a valid local server URL and model to run the test.'
          : 'Add an API key to run the test.'
      );
      return;
    }

    setIsTesting(true);
    setError(null);

    try {
      const reply = await pingAi(saved);
      setNotice(`Connection successful. Provider replied: "${reply.slice(0, 40)}"`);
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : 'Connection test failed. Check your settings.'
      );
    } finally {
      setIsTesting(false);
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
              setNotice('API key remove kar di gayi.');
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
      setNotice('Notifications enabled. Ab reminders time par aayenge.');
    } else {
      setError('Notifications are not allowed. Enable them in system settings.');
    }
  }

  async function testReminder() {
    const sent = await sendTestReminder();
    setPermission(await getNotificationPermission());

    if (sent) {
      setNotice('Test reminder 3 seconds me aayega.');
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
      <GlassBackdrop />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="SETTINGS"
          title="Setup"
          subtitle="AI brain, reminders and your account."
          left={<SidebarButton onPress={openSidebar} />}
        />

        {error ? (
          <View style={styles.bannerWrap}>
            <FormError message={error} />
          </View>
        ) : null}

        {notice ? (
          <View style={styles.notice}>
            <Ionicons name="checkmark-circle" size={15} color={colors.success} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Appearance</Text>
          <GlassView style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingIconWrap}>
                <Ionicons name="color-palette-outline" size={18} color={colors.accent} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Color mode</Text>
                <Text style={styles.settingDescription}>Pick a look, or follow your device setting.</Text>
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
        </View>

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionLabel}>AI Connection</Text>
            <View style={[styles.badge, aiReady ? styles.badgeOn : styles.badgeOff]}>
              <Text style={[styles.badgeText, { color: aiReady ? colors.success : colors.textMuted }]}>
                {aiReady ? 'Ready' : 'Not set'}
              </Text>
            </View>
          </View>

          <GlassView style={styles.card}>
            <View style={styles.settingRow}>
              <View style={[styles.settingIconWrap, { backgroundColor: colors.accentSoft }]}>
                <Ionicons name={isLocalAi ? 'server-outline' : 'cloud-outline'} size={18} color={colors.accent} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>{isLocalAi ? 'Local server' : 'Cloud provider'}</Text>
                <Text style={styles.settingDescription}>
                  {isLocalAi
                    ? 'Connect to an OpenAI-compatible server on your network. No API key required.'
                    : 'Bring your own API key. Orbit does not run a shared server.'}
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
                const active = settings.provider === provider;
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
                onPress={() => { void Linking.openURL(preset.docsUrl); }}
                style={styles.docsLink}
              >
                <Text style={styles.docsLinkText}>{isLocalAi ? 'Ollama setup guide' : 'Get an API key'}</Text>
                <Ionicons name="open-outline" size={14} color={colors.accent} />
              </Pressable>
            ) : null}

            {isLocalAi ? (
              <View style={[styles.infoBox, styles.infoBoxAccent]}>
                <Ionicons name="wifi-outline" size={16} color={colors.accent} />
                <Text style={styles.infoBoxText}>
                  Phone and computer must be on the same Wi-Fi. Use your computer LAN IP, not localhost. For Ollama, start with <Text style={styles.infoCode}>OLLAMA_HOST=0.0.0.0:11434</Text>.
                </Text>
              </View>
            ) : null}

            <View style={styles.fields}>
              <TextField
                label={isLocalAi ? 'Server URL' : 'Base URL'}
                value={settings.baseUrl}
                onChangeText={(value) => update({ baseUrl: value })}
                placeholder={isLocalAi ? 'http://192.168.1.20:11434/v1' : 'https://api.openai.com/v1'}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                hint={isLocalAi ? 'Include http:// or https://, host IP, and port.' : undefined}
              />
              <TextField
                label="Model"
                value={settings.model}
                onChangeText={(value) => update({ model: value })}
                placeholder={preset.model || 'model-name'}
                autoCapitalize="none"
                autoCorrect={false}
                hint={isLocalAi ? 'Example: llama3.2, qwen2.5, mistral' : undefined}
              />
              {!isLocalAi ? (
                <TextField
                  label="API key"
                  value={settings.apiKey}
                  onChangeText={(value) => update({ apiKey: value })}
                  placeholder={preset.keyHint}
                  autoCapitalize="none"
                  autoCorrect={false}
                  secureTextEntry
                  hint="Stored in encrypted SecureStore on this device."
                />
              ) : null}
            </View>

            <View style={styles.buttonRow}>
              <Button
                label="Test connection"
                variant="secondary"
                onPress={() => { void testConnection(); }}
                loading={isTesting}
                disabled={isSaving}
                style={styles.flexButton}
              />
              <Button
                label="Save changes"
                onPress={() => { void persist(true); }}
                loading={isSaving}
                disabled={isTesting}
                style={styles.flexButton}
              />
            </View>

            {!isLocalAi && settings.apiKey ? (
              <Pressable accessibilityRole="button" onPress={confirmRemoveKey} style={styles.removeKey}>
                <Ionicons name="trash-outline" size={14} color={colors.danger} />
                <Text style={styles.removeKeyText}>Remove API key</Text>
              </Pressable>
            ) : null}

            <View style={styles.securityRow}>
              <Ionicons name="shield-checkmark-outline" size={14} color={colors.textFaint} />
              <Text style={styles.securityNote}>
                {isLocalAi
                  ? 'Chat messages go to your local server. Nothing is sent to a cloud provider.'
                  : 'Chat messages go to your selected provider. Tasks, account data, and keys stay on this device.'}
              </Text>
            </View>
          </GlassView>
        </View>

        <Text style={styles.sectionLabel}>MCP TOOLS</Text>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Integrations</Text>
          <McpServersCard onNotice={setNotice} onError={setError} />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Security</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open agent permissions"
            onPress={() => router.push('/permissions' as Href)}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <GlassView style={styles.navCard}>
              <View style={styles.settingIconWrap}>
                <Ionicons name="shield-checkmark-outline" size={18} color={colors.accent} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Agent permissions</Text>
                <Text style={styles.settingDescription}>Approvals, saved grants, paired computers, and audit history.</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
            </GlassView>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Reminders</Text>
          <GlassView style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingIconWrap}>
                <Ionicons name="notifications-outline" size={18} color={colors.accent} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Notifications</Text>
                <Text style={styles.settingDescription}>Get alerted 15 minutes before a task is due.</Text>
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
                    : 'Allow Orbit to send reminder notifications.'}
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
              <Button label="Send test reminder" variant="secondary" onPress={() => { void testReminder(); }} />
            ) : null}
          </GlassView>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
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
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Data</Text>
          <GlassView style={styles.card}>
            <View style={styles.settingRow}>
              <View style={styles.settingIconWrap}>
                <Ionicons name="chatbubbles-outline" size={18} color={colors.accent} />
              </View>
              <View style={styles.settingText}>
                <Text style={styles.settingTitle}>Chat history</Text>
                <Text style={styles.settingDescription}>Clear agent conversations. Tasks and reminders are not affected.</Text>
              </View>
            </View>
            <Button label="Clear chat history" variant="secondary" onPress={confirmClearChat} />
          </GlassView>
        </View>

        <Text style={styles.footer}>
          Orbit v{Constants.expoConfig?.version ?? '1.6.0'} · local-first · Android
        </Text>
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
    loading: {
      flex: 1,
      backgroundColor: colors.background,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: {
      flexGrow: 1,
      paddingHorizontal: spacing.lg,
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
      fontSize: 13,
      lineHeight: 19,
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
    sectionLabel: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
      letterSpacing: 0.2,
    },
    card: {
      padding: spacing.md,
      gap: spacing.md,
    },
    navCard: {
      padding: spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
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
      borderRadius: 12,
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
      fontSize: 15,
      fontWeight: '600',
    },
    settingDescription: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 18,
    },
    badge: {
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
      borderWidth: 1,
    },
    badgeOn: {
      backgroundColor: colors.successSoft,
      borderColor: `${colors.success}33`,
    },
    badgeOff: {
      backgroundColor: colors.surfaceAlt,
      borderColor: colors.border,
    },
    badgeText: {
      fontSize: 11,
      fontWeight: '600',
    },
    segmentedRow: {
      flexDirection: 'row',
      gap: spacing.xs,
      padding: 4,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
    },
    segment: {
      flex: 1,
      minHeight: 44,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      paddingHorizontal: spacing.sm,
    },
    segmentActive: {
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.borderFocus,
    },
    segmentText: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    segmentTextActive: {
      color: colors.accent,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
    },
    fieldLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    providerRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    providerChip: {
      minHeight: 44,
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
      fontSize: 13,
      fontWeight: '500',
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
      fontSize: 13,
      lineHeight: 18,
    },
    infoCode: {
      color: colors.text,
      fontWeight: '600',
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
      fontSize: 13,
      fontWeight: '600',
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
      minHeight: 44,
    },
    removeKeyText: {
      color: colors.danger,
      fontSize: 13,
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
      fontSize: 12,
      lineHeight: 17,
    },
    statusPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      alignSelf: 'flex-start',
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceAlt,
    },
    statusDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
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
      fontSize: 12,
      textAlign: 'center',
      marginTop: spacing.sm,
      marginBottom: spacing.sm,
    },
    pressed: {
      opacity: 0.8,
    },
  });
