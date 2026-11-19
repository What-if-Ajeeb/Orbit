import type { PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand } from './Brand';
import { colors, spacing } from '@/theme';

type AuthShellProps = PropsWithChildren<{
  title: string;
  subtitle: string;
}>;

export function AuthShell({ title, subtitle, children }: AuthShellProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.glowTop} />
      <View pointerEvents="none" style={styles.glowBottom} />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + spacing.xl, paddingBottom: insets.bottom + spacing.xl },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <View style={styles.brandRow}>
              <Brand size={62} />
            </View>

            <Text style={styles.title}>{title}</Text>
            <Text style={styles.subtitle}>{subtitle}</Text>

            <View style={styles.form}>{children}</View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  content: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
  },
  brandRow: {
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '700',
    letterSpacing: -0.6,
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 15,
    lineHeight: 22,
    marginTop: spacing.sm,
  },
  form: {
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  glowTop: {
    position: 'absolute',
    top: -140,
    right: -110,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.accentSoft,
    opacity: 0.9,
  },
  glowBottom: {
    position: 'absolute',
    bottom: -160,
    left: -120,
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(62, 224, 161, 0.05)',
  },
});
