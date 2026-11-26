import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import type { BuilderValidation } from '@/lib/plugins/builder';
import { layout, radius, spacing, typography } from '@/theme';

export function BuilderToggleRow({
  label,
  description,
  checked,
  onToggle,
  disabled = false,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled}
      onPress={onToggle}
      style={({ pressed }) => [
        styles.toggleRow,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={styles.toggleText}>
        <Text style={styles.toggleLabel}>{label}</Text>
        {description ? <Text style={styles.toggleDescription}>{description}</Text> : null}
      </View>
      <View style={[styles.checkbox, checked && styles.checkboxChecked]}>
        {checked ? (
          <Ionicons name="checkmark" size={14} color={colors.onInverse} />
        ) : null}
      </View>
    </Pressable>
  );
}

export function BuilderChipGroup<T extends string>({
  label,
  options,
  values,
  onToggle,
}: {
  label: string;
  options: { value: T; label: string }[];
  values: T[];
  onToggle: (value: T) => void;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chips}>
          {options.map((option) => {
            const selected = values.includes(option.value);

            return (
              <Pressable
                key={option.value}
                accessibilityRole="checkbox"
                accessibilityState={{ selected, checked: selected }}
                onPress={() => onToggle(option.value)}
                style={({ pressed }) => [
                  styles.chip,
                  selected && styles.chipSelected,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
      <Text style={styles.hint}>
        {values.length === 0 ? `No ${label.toLowerCase()} selected` : `${values.length} selected`}
      </Text>
      <View style={styles.srOnly} accessibilityLabel={`${label}: ${values.join(', ') || 'none'}`}>
        <Text>{colors.text}</Text>
      </View>
    </View>
  );
}

export function BuilderJsonField({
  label,
  value,
  onChange,
  hint,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string | null;
  placeholder?: string;
}) {
  const styles = useStyles(makeStyles);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? '{ }'}
        placeholderTextColor="#8f99a8"
        style={[styles.jsonInput, error && styles.jsonInputError]}
        textAlignVertical="top"
      />
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function BuilderFeedback({
  validation,
  success,
}: {
  validation?: BuilderValidation | null;
  success?: string | null;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  if (!validation && !success) return null;

  return (
    <View style={styles.feedback}>
      {success ? (
        <View style={styles.feedbackRow}>
          <Ionicons name="checkmark-circle-outline" size={15} color={colors.success} />
          <Text style={styles.successText}>{success}</Text>
        </View>
      ) : null}
      {validation?.errors.map((message) => (
        <View key={message} style={styles.feedbackRow}>
          <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
          <Text style={styles.errorText}>{message}</Text>
        </View>
      ))}
      {validation?.warnings.map((message) => (
        <View key={message} style={styles.feedbackRow}>
          <Ionicons name="warning-outline" size={15} color={colors.warning} />
          <Text style={styles.warningText}>{message}</Text>
        </View>
      ))}
    </View>
  );
}

export function BuilderStepper({
  steps,
  active,
  onSelect,
}: {
  steps: string[];
  active: number;
  onSelect: (index: number) => void;
}) {
  const styles = useStyles(makeStyles);

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.stepper}>
        {steps.map((step, index) => {
          const selected = index === active;
          const complete = index < active;

          return (
            <Pressable
              key={step}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => onSelect(index)}
              style={({ pressed }) => [
                styles.step,
                selected && styles.stepSelected,
                complete && styles.stepComplete,
                pressed && styles.pressed,
              ]}
            >
              <Text
                style={[
                  styles.stepNumber,
                  selected && styles.stepNumberSelected,
                  complete && styles.stepNumberComplete,
                ]}
              >
                {complete ? '✓' : index + 1}
              </Text>
              <Text style={[styles.stepLabel, selected && styles.stepLabelSelected]}>{step}</Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

export function BuilderInfo({ children }: { children: ReactNode }) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);

  return (
    <View style={[styles.info, { borderColor: colors.border }]}>
      <Ionicons name="information-circle-outline" size={16} color={colors.accent} />
      <Text style={styles.infoText}>{children}</Text>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
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
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      minHeight: layout.touchTarget,
      paddingVertical: spacing.xs,
    },
    toggleText: {
      flex: 1,
      gap: 2,
    },
    toggleLabel: {
      color: colors.text,
      ...typography.body,
    },
    toggleDescription: {
      color: colors.textMuted,
      ...typography.bodySmall,
    },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    checkboxChecked: {
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    },
    chips: {
      flexDirection: 'row',
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
    jsonInput: {
      minHeight: 92,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      padding: spacing.sm + 2,
      fontSize: 12,
      lineHeight: 17,
      fontFamily: 'monospace',
    },
    jsonInputError: {
      borderColor: colors.danger,
    },
    feedback: {
      gap: spacing.xs,
      padding: spacing.sm,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
    },
    feedbackRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.xs + 2,
    },
    successText: {
      flex: 1,
      color: colors.success,
      ...typography.bodySmall,
    },
    errorText: {
      flex: 1,
      color: colors.danger,
      ...typography.bodySmall,
    },
    warningText: {
      flex: 1,
      color: colors.warning,
      ...typography.bodySmall,
    },
    stepper: {
      flexDirection: 'row',
      gap: spacing.sm,
      paddingVertical: 2,
    },
    step: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 2,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    stepSelected: {
      borderColor: colors.accent,
      backgroundColor: colors.accentSoft,
    },
    stepComplete: {
      borderColor: colors.success,
    },
    stepNumber: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '700',
    },
    stepNumberSelected: {
      color: colors.accent,
    },
    stepNumberComplete: {
      color: colors.success,
    },
    stepLabel: {
      color: colors.textMuted,
      fontSize: 13,
      fontWeight: '600',
    },
    stepLabelSelected: {
      color: colors.text,
    },
    pressed: {
      opacity: 0.78,
    },
    disabled: {
      opacity: 0.5,
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
    srOnly: {
      width: 1,
      height: 1,
      opacity: 0,
    },
  });
