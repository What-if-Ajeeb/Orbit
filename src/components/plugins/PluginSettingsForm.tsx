import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Switch } from 'react-native-paper';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import type { PluginPlatformRuntime } from '@/lib/plugins/platform';
import { validateSettingValue } from '@/lib/plugins/storage';
import type { PluginSettingField } from '@/lib/plugins/types';
import { radius, spacing } from '@/theme';

type PluginSettingsFormProps = {
  platform: PluginPlatformRuntime;
  pluginId: string;
  fields: PluginSettingField[];
};

/**
 * Renders the plugin's declared settings schema. Values are written through the
 * registry, which validates the key and type against the manifest; a plugin can
 * never receive undeclared settings through this form.
 */
export function PluginSettingsForm({
  platform,
  pluginId,
  fields,
}: PluginSettingsFormProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const stored = await platform.registry.getSettings(pluginId);

        if (active) {
          setValues(stored);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Could not load plugin settings.'
          );
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [platform, pluginId]);

  async function save(field: PluginSettingField, raw: unknown) {
    const validation = validateSettingValue(field, raw);

    if (!validation.ok) {
      setError(validation.error);
      setNotice(null);
      return;
    }

    const previous = values[field.key];
    setValues((current) => ({ ...current, [field.key]: validation.value }));
    setError(null);

    try {
      await platform.registry.setSetting(pluginId, field.key, validation.value);
      setNotice(`${field.label} saved.`);
    } catch (saveError) {
      setValues((current) => ({ ...current, [field.key]: previous }));
      setError(
        saveError instanceof Error ? saveError.message : 'Could not save the setting.'
      );
      setNotice(null);
    }
  }

  if (fields.length === 0) {
    return (
      <Text style={styles.empty}>
        This plugin does not expose any settings.
      </Text>
    );
  }

  if (loading) {
    return <Text style={styles.empty}>Loading settings…</Text>;
  }

  return (
    <View style={styles.form}>
      {fields.map((field) => {
        const value = values[field.key];
        const disabled = !['installed', 'disabled', 'running'].includes(
          platform.registry.getRecord(pluginId)?.status ?? ''
        );

        return (
          <View key={field.key} style={styles.field}>
            <View style={styles.fieldHeading}>
              <Text style={styles.fieldLabel}>{field.label}</Text>
              {field.type === 'boolean' ? (
                <Switch
                  value={value === true}
                  disabled={disabled}
                  onValueChange={(next) => {
                    void save(field, next);
                  }}
                  color={colors.accent}
                />
              ) : null}
            </View>

            {field.description ? (
              <Text style={styles.fieldDescription}>{field.description}</Text>
            ) : null}

            {field.type === 'string' ? (
              <TextInput
                defaultValue={typeof value === 'string' ? value : ''}
                editable={!disabled}
                placeholder={field.default ?? ''}
                placeholderTextColor={colors.textFaint}
                onEndEditing={(event) => {
                  void save(field, event.nativeEvent.text);
                }}
                style={styles.input}
                autoCapitalize="none"
              />
            ) : null}

            {field.type === 'number' ? (
              <TextInput
                defaultValue={typeof value === 'number' ? String(value) : ''}
                editable={!disabled}
                keyboardType="numeric"
                placeholder={
                  field.default !== undefined ? String(field.default) : ''
                }
                placeholderTextColor={colors.textFaint}
                onEndEditing={(event) => {
                  const parsed = Number(event.nativeEvent.text);
                  void save(field, Number.isFinite(parsed) ? parsed : undefined);
                }}
                style={styles.input}
              />
            ) : null}

            {field.type === 'select' ? (
              <View style={styles.options}>
                {field.options.map((option) => {
                  const selected = value === option.value;

                  return (
                    <Pressable
                      key={option.value}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      disabled={disabled}
                      onPress={() => {
                        void save(field, option.value);
                      }}
                      style={({ pressed }) => [
                        styles.option,
                        selected && styles.optionSelected,
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text
                        style={[
                          styles.optionText,
                          selected && styles.optionTextSelected,
                        ]}
                      >
                        {option.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      })}

      {error ? <Text style={styles.error}>{error}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </View>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
    form: {
      gap: spacing.md,
    },
    empty: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
    },
    field: {
      gap: spacing.xs,
    },
    fieldHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    fieldLabel: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    fieldDescription: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    input: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.fillSoft,
      color: colors.text,
      fontSize: 14,
      paddingHorizontal: spacing.sm + 2,
      paddingVertical: spacing.sm,
    },
    options: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.xs,
    },
    option: {
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.fillSoft,
      paddingHorizontal: spacing.md,
      paddingVertical: 7,
    },
    optionSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    optionText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    optionTextSelected: {
      color: colors.accent,
    },
    error: {
      color: colors.danger,
      fontSize: 12,
      lineHeight: 17,
    },
    notice: {
      color: colors.success,
      fontSize: 12,
      lineHeight: 17,
    },
    pressed: {
      opacity: 0.78,
    },
  });
