import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { layout, radius, spacing, typography } from '@/theme';


type TextFieldProps = Omit<TextInputProps, 'style'> & {
  label: string;
  hint?: string;
};

export function TextField({ label, hint, secureTextEntry, onFocus, onBlur, ...props }: TextFieldProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
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
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceAlt,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: layout.touchTarget + 6,
  },
  inputWrapFocused: {
    borderColor: colors.borderFocus,
  },
  input: {
    flex: 1,
    color: colors.text,
    fontSize: typography.body.fontSize,
    paddingVertical: spacing.sm + 4,
  },
  toggle: {
    color: colors.blue,
    fontSize: 14,
    fontWeight: '600',
  },
  hint: {
    color: colors.textFaint,
    fontSize: 12,
    lineHeight: 17,
  },
  });
