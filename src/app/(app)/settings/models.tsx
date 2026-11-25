import { router, useFocusEffect, type Href } from 'expo-router';
import { Check, Cloud, Cpu, RefreshCw, Server } from 'lucide-react-native';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/Button';
import { FormError } from '@/components/FormError';
import { GlassView } from '@/components/GlassView';
import { SettingsFeedback } from '@/components/settings/SettingsFeedback';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsScreen } from '@/components/settings/SettingsScreen';
import { TextField } from '@/components/TextField';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  listOllamaModels,
  OLLAMA_DISCOVERY_TIMEOUT_MS,
  type OllamaModel,
} from '@/lib/ai/ollama';
import {
  isAiConfigured,
  loadAiSettings,
  PROVIDER_PRESETS,
  saveAiSettings,
  type AiSettings,
} from '@/lib/ai/settings';
import { layout, spacing, typography } from '@/theme';

type DiscoveryStatus = 'idle' | 'loading' | 'success' | 'error';

export default function ModelPreferencesSettingsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [draft, setDraft] = useState('');
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [discoveryStatus, setDiscoveryStatus] = useState<DiscoveryStatus>('idle');
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const discoverModels = useCallback(async (target: AiSettings) => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setDiscoveryStatus('loading');
    setDiscoveryError(null);

    try {
      const installed = await listOllamaModels(target.baseUrl, {
        signal: controller.signal,
        timeoutMs: OLLAMA_DISCOVERY_TIMEOUT_MS,
        retries: 1,
      });
      setModels(installed);
      setDiscoveryStatus('success');
    } catch (discoverError) {
      if (controller.signal.aborted) {
        return;
      }

      setModels([]);
      setDiscoveryStatus('error');
      setDiscoveryError(
        discoverError instanceof Error
          ? discoverError.message
          : 'Could not read installed models from Ollama.'
      );
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null;
      }
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;

      void (async () => {
        const next = await loadAiSettings();

        if (!active) {
          return;
        }

        setSettings(next);
        setDraft(next.model);

        if (next.provider === 'ollama' && next.mode === 'local') {
          void discoverModels(next);
        } else {
          controllerRef.current?.abort();
          setModels([]);
          setDiscoveryStatus('idle');
          setDiscoveryError(null);
        }
      })();

      return () => {
        active = false;
        controllerRef.current?.abort();
      };
    }, [discoverModels])
  );

  if (!settings) {
    return <SettingsScreen title="Model Preferences" loading />;
  }

  const preset = PROVIDER_PRESETS[settings.provider];
  const isOllamaLocal = settings.provider === 'ollama' && settings.mode === 'local';
  const ready = isAiConfigured(settings);
  const currentModel = settings.model || 'Not selected';

  async function applyModel(modelOverride?: string) {
    if (!settings || saving) {
      return;
    }

    const model = (modelOverride ?? draft).trim();

    if (!model) {
      setError('Choose or enter a model name.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const saved = await saveAiSettings({ ...settings, model });
      setSettings(saved);
      setDraft(saved.model);
      setNotice(`Model set to ${saved.model}.`);
    } catch {
      setError('Could not save the model. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsScreen
      title="Model Preferences"
      subtitle="The selected model is used for agent chat and tool calls on this device."
    >
      <SettingsFeedback
        error={error}
        notice={notice}
        onDismissError={() => setError(null)}
      />

      <SettingsGroup title="Current">
        <SettingsRow
          icon={settings.mode === 'local' ? Server : Cloud}
          title={preset.label}
          description={`${settings.mode === 'local' ? 'Local server' : 'Cloud provider'} · ${
            ready ? 'Configured' : 'Not fully configured'
          }`}
          value={settings.mode === 'local' ? 'Local' : 'Cloud'}
          showChevron={false}
        />
        <SettingsRow
          icon={Cpu}
          title="Active model"
          description={
            isOllamaLocal
              ? 'Discovered from the Ollama server on this device.'
              : 'The exact model identifier sent to the provider.'
          }
          value={currentModel}
          showChevron={false}
        />
      </SettingsGroup>

      {isOllamaLocal ? (
        <>
          <SettingsGroup
            title="Installed models"
            footer="The list comes from GET /api/tags on the Ollama server. Nothing is installed or removed here."
          >
            {discoveryStatus === 'loading' ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={colors.accent} />
                <Text style={styles.loadingText}>Reading installed models…</Text>
              </View>
            ) : models.length > 0 ? (
              models.map((model) => {
                const selected = settings.model === model.name;
                const detail = [model.parameterSize, model.quantizationLevel]
                  .filter(Boolean)
                  .join(' · ');

                return (
                  <SettingsRow
                    key={model.name}
                    icon={Cpu}
                    title={model.name}
                    description={detail || 'Installed in Ollama'}
                    showChevron={false}
                    onPress={() => {
                      void applyModel(model.name);
                    }}
                    right={
                      selected ? (
                        <View style={styles.check}>
                          <Check size={16} color={colors.accent} strokeWidth={2.6} />
                        </View>
                      ) : undefined
                    }
                  />
                );
              })
            ) : (
              <View style={styles.loadingRow}>
                <Text style={styles.loadingText}>
                  {discoveryStatus === 'error'
                    ? 'The server could not be reached.'
                    : 'No models are installed on this Ollama server yet.'}
                </Text>
              </View>
            )}
            <SettingsRow
              icon={RefreshCw}
              title="Refresh installed models"
              description="Check the server again without leaving this screen."
              showChevron={false}
              onPress={() => {
                void discoverModels(settings);
              }}
              value={discoveryStatus === 'loading' ? 'Loading…' : 'Refresh'}
            />
          </SettingsGroup>

          {discoveryStatus === 'error' ? (
            <FormError message={discoveryError ?? 'Could not reach Ollama.'} />
          ) : null}
        </>
      ) : null}

      <GlassView style={styles.card}>
        <TextField
          label="Model name"
          value={draft}
          onChangeText={(value) => {
            setDraft(value);
            setNotice(null);
            setError(null);
          }}
          placeholder={preset.model || 'model-name'}
          autoCapitalize="none"
          autoCorrect={false}
          hint={
            isOllamaLocal
              ? 'Choose an installed model above, or enter one that is pulled in Ollama.'
              : 'Use the exact model identifier from your provider.'
          }
        />

        <Button
          label="Save model"
          onPress={() => {
            void applyModel();
          }}
          loading={saving}
        />

        <Text style={styles.note}>
          {isOllamaLocal
            ? 'Changing the model keeps your local server URL. No API key is used for Ollama.'
            : 'Changing the model does not change the provider, base URL, or API key.'}
        </Text>
      </GlassView>

      {!isOllamaLocal && preset.model && preset.model !== draft ? (
        <SettingsGroup title="Provider default">
          <SettingsRow
            icon={Cpu}
            title={`Use ${preset.label} preset`}
            description="Reset the model to the provider default."
            value={preset.model}
            showChevron={false}
            onPress={() => {
              void applyModel(preset.model);
            }}
          />
        </SettingsGroup>
      ) : null}

      {!ready ? (
        <Button
          label="Open AI Connection"
          variant="secondary"
          onPress={() => router.push('/settings/ai-connection' as Href)}
        />
      ) : null}
    </SettingsScreen>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    card: {
      padding: spacing.md,
      gap: spacing.md,
    },
    loadingRow: {
      minHeight: layout.touchTarget + 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surface,
    },
    loadingText: {
      flex: 1,
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    check: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    note: {
      color: colors.textFaint,
      ...typography.caption,
    },
  });
