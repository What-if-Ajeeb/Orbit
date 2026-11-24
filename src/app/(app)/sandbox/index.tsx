import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GlassBackdrop } from '@/components/GlassBackdrop';
import { GlassView } from '@/components/GlassView';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { getMobileSandboxManager } from '@/lib/sandbox/manager';
import { DEFAULT_INPUT_JSON, DEFAULT_MANIFEST_JSON } from '@/lib/sandbox/programs';
import type {
  SandboxProgramManifest,
  SandboxSession,
  SandboxValidationReport,
} from '@/lib/sandbox/types';
import { fonts, radius, spacing } from '@/theme';

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : 'parse error'}`
    );
  }
}

function sessionColor(session: SandboxSession, colors: AppTheme['colors']): string {
  switch (session.status) {
    case 'completed':
      return colors.success;
    case 'failed':
      return colors.danger;
    case 'rejected':
      return colors.warning;
    default:
      return colors.accent;
  }
}

export default function SandboxScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { open: openSidebar } = useSidebar();
  const manager = useMemo(() => getMobileSandboxManager(), []);
  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot
  );

  const [manifestText, setManifestText] = useState(DEFAULT_MANIFEST_JSON);
  const [inputText, setInputText] = useState(DEFAULT_INPUT_JSON);
  const [validation, setValidation] = useState<SandboxValidationReport | null>(null);
  const [output, setOutput] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'android') {
      return;
    }

    let active = true;
    void manager.initialize().catch((initError: unknown) => {
      if (active) {
        setError(initError instanceof Error ? initError.message : 'Sandbox core unavailable.');
      }
    });

    return () => {
      active = false;
    };
  }, [manager]);

  function resetMessages() {
    setError(null);
    setNotice(null);
  }

  async function handleValidate() {
    resetMessages();
    setValidation(null);

    try {
      const manifest = parseJson<SandboxProgramManifest>(manifestText, 'Manifest');
      const report = await manager.validate(manifest);
      setValidation(report);
      setNotice(report.ok ? 'Manifest accepted by the Rust policy core.' : null);
    } catch (validateError) {
      setError(validateError instanceof Error ? validateError.message : 'Validation failed.');
    }
  }

  async function handleExecute() {
    resetMessages();
    setOutput('');

    try {
      const manifest = parseJson<SandboxProgramManifest>(manifestText, 'Manifest');
      const input = parseJson<Record<string, unknown>>(inputText, 'Input');
      const result = await manager.execute(manifest, input);
      setOutput(JSON.stringify(result, null, 2));
      setNotice(
        result.ok
          ? `Program completed in the isolated process (${result.instructionsExecuted} instructions).`
          : 'Program rejected by the policy core.'
      );
    } catch (executeError) {
      setError(executeError instanceof Error ? executeError.message : 'Execution failed.');
    }
  }

  async function handleShutdown() {
    resetMessages();

    try {
      await manager.shutdown();
      setNotice('Sandbox service unbound; host session history cleared.');
    } catch (shutdownError) {
      setError(shutdownError instanceof Error ? shutdownError.message : 'Shutdown failed.');
    }
  }

  const unsupported = Platform.OS !== 'android';
  const description = snapshot.description;
  const busy = snapshot.busy > 0;

  return (
    <View style={styles.root}>
      <GlassBackdrop />
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.headerRow}>
          <SidebarButton onPress={openSidebar} />
          <ScreenHeader
            title="Mobile Sandbox"
            subtitle="Run bounded programs behind an Android process boundary."
          />
        </View>

        {unsupported ? (
          <View style={[styles.banner, styles.bannerWarning]}>
            <Ionicons name="phone-portrait-outline" size={16} color={colors.warning} />
            <Text style={styles.bannerWarningText}>
              Android only. Web, iOS and Expo Go cannot load the native sandbox core.
            </Text>
          </View>
        ) : null}

        {error ?? snapshot.lastError ? (
          <View style={[styles.banner, styles.bannerError]}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.bannerErrorText}>{error ?? snapshot.lastError}</Text>
          </View>
        ) : null}

        {notice ? (
          <View style={[styles.banner, styles.bannerNotice]}>
            <Ionicons name="checkmark-circle-outline" size={16} color={colors.success} />
            <Text style={styles.bannerNoticeText}>{notice}</Text>
          </View>
        ) : null}

        <GlassView style={styles.card}>
          <View style={styles.cardHeading}>
            <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
            <Text style={styles.cardTitle}>Policy core</Text>
            {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          </View>

          {description ? (
            <>
              <Text style={styles.body}>
                {description.isolation} · {description.executionFormat}
              </Text>
              <View style={styles.stats}>
                <Stat label="Core" value={description.coreVersion} />
                <Stat label="Policy" value={`v${description.policyVersion}`} />
                <Stat label="Steps" value={String(description.limits.maxInstructions)} />
              </View>
              <Text style={styles.meta}>
                {description.allowedOperations.join(' · ')}
              </Text>
            </>
          ) : (
            <Text style={styles.body}>
              {unsupported
                ? 'The native core is not available on this platform.'
                : 'Connecting to the isolated sandbox service…'}
            </Text>
          )}
        </GlassView>

        <GlassView style={styles.card}>
          <View style={styles.cardHeading}>
            <Ionicons name="code-slash-outline" size={20} color={colors.accent} />
            <Text style={styles.cardTitle}>Deterministic program</Text>
          </View>
          <Text style={styles.body}>
            Manifests are data. Rust rejects unknown fields, disallowed operations and
            oversized values before anything runs.
          </Text>

          <Text style={styles.fieldLabel}>MANIFEST JSON</Text>
          <TextInput
            accessibilityLabel="Sandbox manifest JSON"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            scrollEnabled={false}
            style={styles.editor}
            value={manifestText}
            onChangeText={setManifestText}
          />

          <Text style={styles.fieldLabel}>INPUT JSON</Text>
          <TextInput
            accessibilityLabel="Sandbox input JSON"
            autoCapitalize="none"
            autoCorrect={false}
            multiline
            scrollEnabled={false}
            style={[styles.editor, styles.inputEditor]}
            value={inputText}
            onChangeText={setInputText}
          />

          {validation ? (
            <Text style={[styles.result, validation.ok ? styles.successText : styles.errorText]}>
              {validation.ok
                ? 'Manifest valid'
                : `Rejected: ${validation.errors.join(' ')}`}
            </Text>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void handleValidate()}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            >
              <Ionicons name="checkmark-done-outline" size={16} color={colors.text} />
              <Text style={styles.buttonText}>Validate</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={busy || unsupported}
              onPress={() => void handleExecute()}
              style={({ pressed }) => [
                styles.button,
                styles.buttonAccent,
                (busy || unsupported) && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="play" size={15} color={colors.onInverse} />
              <Text style={styles.buttonTextOnAccent}>Run in sandbox</Text>
            </Pressable>
          </View>

          <Text style={styles.hint}>
            Every run asks the ORBIT approval host for “Run in sandbox”. Denials and
            timeouts never reach Rust.
          </Text>
        </GlassView>

        {output ? (
          <GlassView style={styles.card}>
            <Text style={styles.fieldLabel}>LAST RESULT</Text>
            <Text style={styles.result}>{output}</Text>
          </GlassView>
        ) : null}

        <GlassView style={styles.card}>
          <View style={styles.cardHeading}>
            <Ionicons name="list-outline" size={20} color={colors.accent} />
            <Text style={styles.cardTitle}>Sessions</Text>
          </View>

          {snapshot.sessions.length === 0 ? (
            <Text style={styles.body}>No sandbox sessions yet.</Text>
          ) : (
            snapshot.sessions.map((session) => (
              <View key={session.id} style={styles.session}>
                <View style={styles.sessionTop}>
                  <Text numberOfLines={1} style={styles.sessionId}>
                    {session.pluginId}@{session.version}
                  </Text>
                  <Text style={[styles.sessionStatus, { color: sessionColor(session, colors) }]}>
                    ● {session.status}
                  </Text>
                </View>
                <Text style={styles.meta}>
                  {session.instructionsExecuted ?? 0} instructions · {session.id}
                </Text>
                {session.errors && session.errors.length > 0 ? (
                  <Text numberOfLines={3} style={styles.errorText}>
                    {session.errors.join(' ')}
                  </Text>
                ) : null}
              </View>
            ))
          )}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => manager.clearHistory()}
              style={({ pressed }) => [styles.button, pressed && styles.pressed]}
            >
              <Ionicons name="trash-outline" size={16} color={colors.text} />
              <Text style={styles.buttonText}>Clear history</Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              disabled={busy || unsupported}
              onPress={() => void handleShutdown()}
              style={({ pressed }) => [
                styles.button,
                (busy || unsupported) && styles.buttonDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name="power-outline" size={16} color={colors.text} />
              <Text style={styles.buttonText}>Stop service</Text>
            </Pressable>
          </View>
        </GlassView>

        <Text style={styles.footnote}>
          Process isolation limits privileges available to the service; it is not a
          claim of complete isolation from the Android kernel or Binder. Programs are
          deterministic and cannot access files, network or device permissions.
        </Text>
      </ScrollView>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.stat}>
      <Text numberOfLines={1} style={styles.statValue}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      paddingHorizontal: spacing.md,
      gap: spacing.md,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    card: {
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.sm,
    },
    cardHeading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      flex: 1,
    },
    body: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
    },
    meta: {
      color: colors.textFaint,
      fontSize: 11,
      lineHeight: 16,
    },
    stats: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    stat: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: spacing.xs,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
    },
    statValue: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    statLabel: {
      color: colors.textFaint,
      fontSize: 10,
      textTransform: 'uppercase',
    },
    fieldLabel: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 1,
      marginTop: spacing.xs,
    },
    editor: {
      minHeight: 220,
      maxHeight: 280,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      color: colors.text,
      fontFamily: fonts.mono,
      fontSize: 11,
      lineHeight: 16,
      padding: spacing.sm,
      textAlignVertical: 'top',
    },
    inputEditor: {
      minHeight: 90,
      maxHeight: 140,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginTop: spacing.xs,
    },
    button: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      minHeight: 42,
      paddingHorizontal: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    buttonAccent: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    buttonDisabled: {
      opacity: 0.45,
    },
    buttonText: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    buttonTextOnAccent: {
      color: colors.onInverse,
      fontSize: 13,
      fontWeight: '700',
    },
    pressed: {
      opacity: 0.7,
    },
    hint: {
      color: colors.textFaint,
      fontSize: 11,
      lineHeight: 16,
    },
    result: {
      color: colors.text,
      fontFamily: fonts.mono,
      fontSize: 11,
      lineHeight: 16,
    },
    successText: {
      color: colors.success,
    },
    errorText: {
      color: colors.danger,
    },
    session: {
      paddingVertical: spacing.xs,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
      gap: 2,
    },
    sessionTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    sessionId: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '600',
      flex: 1,
    },
    sessionStatus: {
      fontSize: 11,
      fontWeight: '700',
      textTransform: 'uppercase',
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      padding: spacing.sm,
    },
    bannerWarning: {
      backgroundColor: colors.warningSoft,
    },
    bannerWarningText: {
      color: colors.warning,
      fontSize: 12,
      flex: 1,
    },
    bannerError: {
      backgroundColor: colors.dangerSoft,
    },
    bannerErrorText: {
      color: colors.danger,
      fontSize: 12,
      flex: 1,
    },
    bannerNotice: {
      backgroundColor: colors.successSoft,
    },
    bannerNoticeText: {
      color: colors.success,
      fontSize: 12,
      flex: 1,
    },
    footnote: {
      color: colors.textFaint,
      fontSize: 11,
      lineHeight: 16,
      paddingHorizontal: spacing.xs,
    },
  });
