import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { useSession } from '@/context/auth';
import type { AgentTask } from '@/lib/agent-runtime/types';
import { ArtifactStore } from '@/lib/artifacts/store';
import { artifactTypeLabel, type ArtifactRef } from '@/lib/artifacts/types';
import type { ToolExecutionEvent } from '@/lib/chat';
import { statusLabel } from '@/lib/task-workspace';
import { radius, spacing } from '@/theme';

function utf8Length(input: string): number {
  let size = 0;

  for (const character of input) {
    const code = character.codePointAt(0) ?? 0;
    size += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }

  return size;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function summaryLines(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#') && !line.startsWith('```'))
    .slice(0, 2)
    .map((line) => line.slice(0, 160));
}

function metricLines(content: string): string[] {
  return content
    .split('\n')
    .map((line) => line.trim().replace(/^[-*]\s*/, ''))
    .filter((line) => line.length <= 90 && /:/.test(line) && /\d/.test(line))
    .slice(0, 3);
}

/** Report/file preview built only from an artifact that really exists. */
export function ReportPreviewCard({ artifact }: { artifact: ArtifactRef }) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const router = useRouter();
  const { user } = useSession();
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    if (!user) {
      return;
    }

    let active = true;

    void (async () => {
      try {
        const found = await new ArtifactStore(db).get(user.id, artifact.id);

        if (active) {
          setContent(found?.content ?? null);
        }
      } catch {
        if (active) {
          setContent(null);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [artifact.id, db, user]);

  const label = artifactTypeLabel(artifact.type);
  const summary = content === null ? [] : summaryLines(content);
  const metrics = content === null ? [] : metricLines(content);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Preview report ${artifact.title}`}
      disabled={content === null}
      onPress={() => router.push({ pathname: '/artifact', params: { id: artifact.id } })}
      style={({ pressed }) => [styles.card, pressed && content !== null && styles.pressed]}
    >
      <View style={styles.cardHeader}>
        <View style={styles.icon}>
          <Ionicons name="document-text-outline" size={18} color={colors.accent} />
        </View>
        <View style={styles.cardHeaderCopy}>
          <Text numberOfLines={1} style={styles.cardTitle}>
            {artifact.title}
          </Text>
          <Text style={styles.cardMeta}>
            {label} · v{artifact.version}
            {content !== null ? ` · ${formatSize(utf8Length(content))}` : ''}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={17} color={colors.textFaint} />
      </View>

      {content === null ? (
        <Text style={styles.muted}>This report is no longer available.</Text>
      ) : (
        <View style={styles.cardBody}>
          {summary.map((line, index) => (
            <Text key={`summary-${index}`} numberOfLines={2} style={styles.summary}>
              {line}
            </Text>
          ))}
          {metrics.map((line, index) => (
            <Text key={`metric-${index}`} numberOfLines={1} style={styles.metric}>
              {line}
            </Text>
          ))}
          <Text style={styles.previewAction}>Preview report</Text>
        </View>
      )}
    </Pressable>
  );
}

/** Structured research output from real traces and tool events. */
export function ResearchSummaryCard({
  traces,
  events,
}: {
  traces: string[];
  events: ToolExecutionEvent[];
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const rows = [
    ...traces.map((trace) => ({ key: `trace-${trace}`, label: 'Check', value: trace })),
    ...events.map((event) => ({
      key: `event-${event.id}`,
      label: event.toolName,
      value: event.summary,
    })),
  ].slice(0, 5);

  if (rows.length === 0) {
    return null;
  }

  return (
    <View accessibilityRole="group" accessibilityLabel="Research summary" style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.icon}>
          <Ionicons name="search-outline" size={18} color={colors.accent} />
        </View>
        <View style={styles.cardHeaderCopy}>
          <Text style={styles.cardTitle}>Research summary</Text>
          <Text style={styles.cardMeta}>{rows.length} recorded {rows.length === 1 ? 'step' : 'steps'}</Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        {rows.map((row) => (
          <View key={row.key} style={styles.summaryRow}>
            <Ionicons name="checkmark-circle-outline" size={13} color={colors.success} />
            <Text numberOfLines={2} style={styles.summaryValue}>
              {row.value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Status/result of the real agent task linked to the conversation. */
export function TaskResultCard({ task }: { task: AgentTask }) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const reason = task.verification?.reason ?? task.error;

  return (
    <View accessibilityRole="group" accessibilityLabel="Task result" style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.icon}>
          <Ionicons name="cube-outline" size={18} color={colors.accent} />
        </View>
        <View style={styles.cardHeaderCopy}>
          <Text style={styles.cardTitle}>Task result</Text>
          <Text style={styles.cardMeta}>
            {statusLabel(task.status)} · attempt {task.attempts}
          </Text>
        </View>
      </View>
      <View style={styles.cardBody}>
        {reason ? (
          <Text numberOfLines={3} style={styles.summary}>
            {reason}
          </Text>
        ) : null}
        <Text style={styles.muted}>Recorded status: {task.status}</Text>
      </View>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    card: {
      alignSelf: 'stretch',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      padding: spacing.md,
    },
    pressed: {
      opacity: 0.72,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    cardHeaderCopy: {
      flex: 1,
      gap: 2,
    },
    icon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    cardMeta: {
      color: colors.textMuted,
      fontSize: 11,
    },
    cardBody: {
      gap: 6,
    },
    summary: {
      color: colors.text,
      fontSize: 13,
      lineHeight: 19,
    },
    metric: {
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    summaryRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
    },
    summaryValue: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    muted: {
      color: colors.textFaint,
      fontSize: 12,
    },
    previewAction: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: '600',
      paddingTop: 2,
    },
  });
