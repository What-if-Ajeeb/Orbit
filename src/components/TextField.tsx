import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { colors, radius, spacing } from '@/theme';

type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  hint?: string;
};

export function TextField({ label, hint, secureTextEntry, onFocus, onBlur, ...props }: TextFieldProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const isPassword = Boolean(secureTextEntry);

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={[styles.inputWrap, isFocused && styles.inputWrapFocused]}>
        <TextInput
          {...props}
          secureTextEntry={isPassword && !isPasswordVisible}
          placeholderTextColor={colors.textFaint}
          selectionColor={colors.accent}
          style={styles.input}
          onFocus={(event) => {
            setIsFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setIsFocused(false);
            onBlur?.(event);
          }}
        />
        {isPassword ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isPasswordVisible ? 'Hide password' : 'Show password'}
            hitSlop={10}
            onPress={() => setIsPasswordVisible((visible) => !visible)}
          >
            <Text style={styles.toggle}>{isPasswordVisible ? 'Hide' : 'Show'}</Text>
          </Pressable>
        ) : null}
      </View>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    gap: spacing.xs + 2,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 54,
  },
  inputWrapFocused: {
    borderColor: colors.borderFocus,
    backgroundColor: colors.backgroundElevated,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: 16,
    paddingVertical: spacing.sm + 4,
  },
  toggle: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  hint: {
    color: colors.textFaint,
    fontSize: 12,
    lineHeight: 17,
  },
});
