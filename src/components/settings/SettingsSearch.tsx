import { Search, X } from 'lucide-react-native';
import type { RefObject } from 'react';
import { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputInstance,
} from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { radius, spacing, typography } from '@/theme';

type SettingsSearchProps = {
  value: string;
  onChangeText: (value: string) => void;
  inputRef?: RefObject<TextInputInstance | null>;
  bottomInset?: number;
  onFocus?: () => void;
  onBlur?: () => void;
};

/** Bottom search field used to filter the settings catalog. */
export function SettingsSearch({
  value,
  onChangeText,
  inputRef,
  bottomInset = 0,
  onFocus,
  onBlur,
}: SettingsSearchProps) {
  const { colors, isLight } = useAppTheme();
  const styles = useStyles(makeStyles);
  const [focused, setFocused] = useState(false);

  function handleFocus() {
    setFocused(true);
    onFocus?.();
  }

  function handleBlur() {
    setFocused(false);
    onBlur?.();
  }

  return (
    <View style={[styles.root, { paddingBottom: Math.max(bottomInset, spacing.sm) }]}>
      <View style={[styles.field, focused && styles.fieldFocused]}>
        <Search size={18} color={colors.textMuted} strokeWidth={2} />

        <TextInput
          ref={inputRef}
          value={value}
          onChangeText={onChangeText}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder="Search settings"
          placeholderTextColor={colors.textFaint}
          accessibilityLabel="Search settings"
          accessibilityHint="Filters the settings shown above"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardAppearance={isLight ? 'light' : 'dark'}
          returnKeyType="search"
          selectionColor={colors.accent}
          style={styles.input}
        />

        {value.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            hitSlop={10}
            onPress={() => {
              onChangeText('');
              inputRef?.current?.focus();
            }}
            style={({ pressed }) => [styles.clear, pressed && styles.pressed]}
          >
            <X size={15} color={colors.textMuted} strokeWidth={2.4} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      backgroundColor: colors.background,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingHorizontal: spacing.md,
      paddingTop: spacing.sm,
    },
    field: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.pill,
      paddingLeft: spacing.md,
      paddingRight: spacing.xs,
    },
    fieldFocused: {
      borderColor: colors.accent,
    },
    input: {
      flex: 1,
      color: colors.text,
      ...typography.body,
      paddingVertical: spacing.sm,
    },
    clear: {
      width: 34,
      height: 34,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
    },
    pressed: {
      opacity: 0.7,
    },
  });
