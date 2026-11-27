import type { Href } from 'expo-router';
import type { PropsWithChildren, ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { layout, spacing, typography } from '@/theme';

import { SettingsHeader } from './SettingsHeader';

type SettingsScreenProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  fallback?: Href;
  loading?: boolean;
}>;

/** Shared scaffold for settings detail screens. */
export function SettingsScreen({
  title,
  subtitle,
  headerRight,
  fallback,
  loading = false,
  children,
}: SettingsScreenProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <SettingsHeader title={title} right={headerRight} fallback={fallback} />

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.flex}
        >
          <ScrollView
            contentContainerStyle={[
              styles.content,
              { paddingBottom: insets.bottom + spacing.xl },
            ]}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            {children}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    flex: {
      flex: 1,
    },
    loading: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: {
      width: '100%',
      maxWidth: layout.contentMaxWidth,
      alignSelf: 'center',
      paddingHorizontal: layout.gutter,
      paddingTop: spacing.sm,
      gap: spacing.lg,
    },
    subtitle: {
      color: colors.textMuted,
      ...typography.bodySmall,
      paddingHorizontal: spacing.xs,
    },
  });
