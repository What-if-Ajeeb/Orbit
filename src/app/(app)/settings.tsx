import Ionicons from '@expo/vector-icons/Ionicons';
import Constants from 'expo-constants';
import { useFocusEffect } from 'expo-router';
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/Button';
import { FormError } from '@/components/FormError';
import { McpServersCard } from '@/components/McpServersCard';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { TextField } from '@/components/TextField';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { pingAi } from '@/lib/ai/providers';
import {
  applyProviderPreset,
  isAiConfigured,
  loadAiSettings,
  PROVIDER_ORDER,
  PROVIDER_PRESETS,
  saveAiSettings,
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
import { colors, radius, spacing } from '@/theme';

function permissionLabel(state: NotificationPermissionState): string {
  if (state === 'granted') {
    return 'Reminders allowed';
  }

  if (state === 'denied') {
    return 'Blocked in system settings';
  }

  return 'Not enabled yet';
}

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { user, signOut } = useSession();
  const { open: openSidebar } = useSidebar();
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [permission, setPermission] = useState<NotificationPermissionState>('undetermined');
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
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

  async function persist(showNotice: boolean): Promise<AiSettings | null> {
    const baseUrl = currentSettings.baseUrl.trim();
    const model = currentSettings.model.trim();
    const apiKey = currentSettings.apiKey.trim();

    if (!baseUrl || !model) {
      setError('Base URL aur model dono required hain.');
      return null;
    }

    setIsSaving(true);
    setError(null);

    try {
      const saved = await saveAiSettings({ ...currentSettings, baseUrl, model, apiKey });
      setSettings(saved);

      if (showNotice) {
        setNotice('AI settings save ho gayi. Ab Agent full AI mode me chalega.');
      }

      return saved;
    } catch {
      setError('Settings save nahi ho payi. Dobara try karo.');
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
      setError('Test karne ke liye API key bhi daalo.');
      return;
    }

    setIsTesting(true);
    setError(null);

    try {
      const reply = await pingAi(saved);
      setNotice(`Connection successful ✅ Provider ne reply kiya: “${reply.slice(0, 40)}”`);
    } catch (testError) {
      setError(
        testError instanceof Error
          ? testError.message
          : 'Connection test fail ho gaya. Settings check karo.'
      );
    } finally {
      setIsTesting(false);
    }
  }

  function confirmRemoveKey() {
    Alert.alert('Remove API key?', 'Agent local mode me chala jayega. Tasks safe rahenge.', [
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
              setError('Key remove nahi ho payi.');
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
      setError('Notifications allow nahi hui. System settings se permission do.');
    }
  }

  async function testReminder() {
    const sent = await sendTestReminder();
    setPermission(await getNotificationPermission());

    if (sent) {
      setNotice('Test reminder 3 seconds me aayega.');
    } else {
      setError('Test reminder nahi bhej paye. Notification permission check karo.');
    }
  }

  function confirmClearChat() {
    Alert.alert('Clear chat history?', 'Tasks aur reminders delete nahi honge.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await getChatStore(db).clearAllChat(activeUser.id);
            setNotice('Chat history clear ho gayi.');
          })();
        },
      },
    ]);
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'Aapka local account is device par rahega.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setIsSigningOut(true);

            try {
              await signOut();
            } finally {
              setIsSigningOut(false);
            }
          })();
        },
      },
    ]);
  }

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.glow} />

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
          subtitle="AI brain, reminders aur your account."
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

        <Text style={styles.sectionLabel}>AI BRAIN</Text>

        <View style={styles.card}>
          <View style={styles.cardTitleRow}>
            <View style={styles.cardTitleText}>
              <Text style={styles.cardTitle}>Cloud AI</Text>
              <Text style={styles.cardCaption}>
                Apni API key laao. Orbit kisi shared server se nahi chalta.
              </Text>
            </View>
            <View style={[styles.badge, aiReady ? styles.badgeOn : styles.badgeOff]}>
              <Text
                style={[styles.badgeText, { color: aiReady ? colors.success : colors.textMuted }]}
              >
                {aiReady ? 'READY' : 'NOT SET'}
              </Text>
            </View>
          </View>

          <View style={styles.providerRow}>
            {PROVIDER_ORDER.map((provider) => {
              const active = settings.provider === provider;

              return (
                <Pressable
                  key={provider}
                  accessibilityRole="button"
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

          <Text style={styles.providerNote}>{preset.note}</Text>

          {preset.docsUrl ? (
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL(preset.docsUrl);
              }}
              style={styles.docsLink}
            >
              <Text style={styles.docsLinkText}>Get an API key</Text>
              <Ionicons name="open-outline" size={13} color={colors.accent} />
            </Pressable>
          ) : null}

          <View style={styles.fields}>
            <TextField
              label="Base URL"
              value={settings.baseUrl}
              onChangeText={(value) => update({ baseUrl: value })}
              placeholder="https://api.openai.com/v1"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            <TextField
              label="Model"
              value={settings.model}
              onChangeText={(value) => update({ model: value })}
              placeholder={preset.model || 'model-name'}
              autoCapitalize="none"
              autoCorrect={false}
            />

            <TextField
              label="API key"
              value={settings.apiKey}
              onChangeText={(value) => update({ apiKey: value })}
              placeholder={preset.keyHint}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              hint="Key device ke encrypted SecureStore me save hoti hai."
            />
          </View>

          <View style={styles.buttonRow}>
            <Button
              label="Save"
              onPress={() => {
                void persist(true);
              }}
              loading={isSaving}
              disabled={isTesting}
              style={styles.flexButton}
            />
            <Button
              label="Test"
              variant="secondary"
              onPress={() => {
                void testConnection();
              }}
              loading={isTesting}
              disabled={isSaving}
              style={styles.flexButton}
            />
          </View>

          {settings.apiKey ? (
            <Pressable
              accessibilityRole="button"
              onPress={confirmRemoveKey}
              style={styles.removeKey}
            >
              <Ionicons name="trash-outline" size={13} color={colors.danger} />
              <Text style={styles.removeKeyText}>Remove API key</Text>
            </Pressable>
          ) : null}

          <Text style={styles.securityNote}>
            Chat messages aapke AI provider ko jaate hain. Tasks, account aur key is phone par
            rehte hain.
          </Text>
        </View>

        <Text style={styles.sectionLabel}>MCP TOOLS</Text>

        <McpServersCard onNotice={setNotice} onError={setError} />

        <Text style={styles.sectionLabel}>REMINDERS</Text>

        <View style={styles.card}>
          <View style={styles.statusRow}>
            <View
              style={[
                styles.statusDot,
                { backgroundColor: permission === 'granted' ? colors.success : colors.textFaint },
              ]}
            />
            <Text style={styles.statusText}>{permissionLabel(permission)}</Text>
          </View>

          <Text style={styles.cardCaption}>
            Due time ya reminder set karne par local notification aayega — app band ho tab bhi.
          </Text>

          <View style={styles.buttonRow}>
            <Button
              label={permission === 'granted' ? 'Send test' : 'Enable'}
              variant="secondary"
              onPress={() => {
                void (permission === 'granted' ? testReminder() : enableNotifications());
              }}
              style={styles.flexButton}
            />
            {permission === 'denied' ? (
              <Button
                label="System settings"
                variant="ghost"
                onPress={() => {
                  void Linking.openSettings();
                }}
                style={styles.flexButton}
              />
            ) : null}
          </View>
        </View>

        <Text style={styles.sectionLabel}>ACCOUNT</Text>

        <View style={styles.card}>
          <View style={styles.profileRow}>
            <View style={styles.profileAvatar}>
              <Ionicons name="person" size={18} color={colors.accent} />
            </View>
            <View style={styles.profileText}>
              <Text style={styles.profileName}>{user.name}</Text>
              <Text style={styles.profileEmail}>{user.email}</Text>
            </View>
          </View>

          <Button
            label="Sign out"
            variant="danger"
            onPress={confirmSignOut}
            loading={isSigningOut}
            style={styles.signOut}
          />
        </View>

        <Text style={styles.sectionLabel}>DATA</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Chat history</Text>
          <Text style={styles.cardCaption}>
            Agent conversation clear karo. Tasks aur reminders untouched rehte hain.
          </Text>

          <Button
            label="Clear chat history"
            variant="secondary"
            onPress={confirmClearChat}
            style={styles.clearButton}
          />
        </View>

        <Text style={styles.footer}>
          Orbit v{Constants.expoConfig?.version ?? '1.2.0'} · local-first · Android
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
  },
  glow: {
    position: 'absolute',
    top: -170,
    right: -110,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.accentSoft,
  },
  bannerWrap: {
    marginTop: spacing.lg,
  },
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: 'rgba(62, 224, 161, 0.25)',
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
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginTop: spacing.xl,
    marginBottom: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.md + 2,
    marginTop: spacing.sm,
    gap: spacing.md,
  },
  cardTitleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  cardTitleText: {
    flex: 1,
    gap: 4,
  },
  cardTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  cardCaption: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  badge: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  badgeOn: {
    backgroundColor: colors.successSoft,
  },
  badgeOff: {
    backgroundColor: colors.surfaceAlt,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.9,
  },
  providerRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  providerChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceAlt,
    paddingHorizontal: spacing.sm + 4,
    paddingVertical: 7,
  },
  providerChipActive: {
    borderColor: colors.borderFocus,
    backgroundColor: colors.accentSoft,
  },
  providerText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  providerTextActive: {
    color: colors.accent,
  },
  providerNote: {
    color: colors.textFaint,
    fontSize: 12,
    lineHeight: 17,
    marginTop: -4,
  },
  docsLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: -6,
  },
  docsLinkText: {
    color: colors.accent,
    fontSize: 12,
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
    paddingVertical: 4,
  },
  removeKeyText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  securityNote: {
    color: colors.textFaint,
    fontSize: 11,
    lineHeight: 16,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  statusText: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  profileRow: {
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
  profileText: {
    flex: 1,
    gap: 2,
  },
  profileName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  profileEmail: {
    color: colors.textMuted,
    fontSize: 13,
  },
  signOut: {
    marginTop: spacing.xs,
  },
  clearButton: {
    marginTop: spacing.xs,
  },
  footer: {
    color: colors.textFaint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
