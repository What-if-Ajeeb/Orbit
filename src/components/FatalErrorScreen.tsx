import * as Clipboard from 'expo-clipboard';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { getDiagnosticReport, subscribeDiagnosticReport, type DiagnosticReport } from '@/lib/diagnostics';
import { darkColors, radius, spacing } from '@/theme';

/**
 * Full-screen crash report. It deliberately uses fixed colors and no app
 * providers so it still renders when a provider is the thing that failed.
 */
export function FatalErrorScreen() {
  const [report, setReport] = useState<DiagnosticReport | null>(() => getDiagnosticReport());

  useEffect(() =>
    subscribeDiagnosticReport(() => {
      setReport(getDiagnosticReport());
    })
  , []);

  const copyDetails = useCallback(() => {
    if (!report) {
      return;
    }

    const details = [
      `Phase: ${report.phase}`,
      `Time: ${report.at}`,
      `Message: ${report.message}`,
      report.stack ? `Stack:\n${report.stack}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');

    void Clipboard.setStringAsync(details);
  }, [report]);

  if (!report) {
    return null;
  }

  return (
    <View style={[StyleSheet.absoluteFill, styles.root]} accessibilityRole="alert">
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.heading}>Orbit could not finish starting</Text>
        <Text style={styles.phase}>{report.phase}</Text>
        <Text style={styles.message}>{report.message}</Text>
        {report.stack ? <Text style={styles.stack}>{report.stack}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Copy crash details"
          onPress={copyDetails}
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
        >
          <Text style={styles.buttonLabel}>Copy crash details</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: darkColors.background,
    zIndex: 100,
  },
  content: {
    padding: spacing.lg,
    paddingTop: spacing.xl + 24,
    gap: spacing.md,
  },
  heading: {
    color: darkColors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  phase: {
    color: darkColors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
  message: {
    color: darkColors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  stack: {
    color: darkColors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  button: {
    alignSelf: 'flex-start',
    minHeight: 48,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: darkColors.border,
    paddingHorizontal: spacing.lg,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonLabel: {
    color: darkColors.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
