import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSQLiteContext } from 'expo-sqlite';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { TelemetryStore, type TelemetrySummary } from '@/lib/telemetry';
import { radius, spacing } from '@/theme';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';

export default function TelemetryScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const insets = useSafeAreaInsets();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) {
      return;
    }

    try {
      setLoading(true);
      const store = new TelemetryStore(db);
      const next = await store.getSummary(user.id);
      setSummary(next);
    } catch (loadError) {
      console.warn('Could not load telemetry.', loadError);
    } finally {
      setLoading(false);
    }
  }, [db, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!user) {
    return null;
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  const s = summary!;
  const totalTokens = s.totalTokensIn + s.totalTokensOut;
  const cacheTotal = s.cacheHits + s.cacheMisses;
  const cacheHitRate =
    cacheTotal > 0 ? Math.round((s.cacheHits / cacheTotal) * 100) : 0;

  return (
    <View style={styles.root}>
      <View pointerEvents="none" style={styles.glow} />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md, paddingBottom: spacing.xl },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <ScreenHeader
          eyebrow="OBSERVABILITY"
          title="Telemetry"
          subtitle="Tool durations, token usage and cache hit rates."
          left={<SidebarButton onPress={openSidebar} />}
        />

        <View style={styles.statsRow}>
          <StatCard value={String(s.totalTurns)} label="Turns" icon="sparkles" />
          <StatCard
            value={String(s.totalToolCalls)}
            label="Tool calls"
            icon="construct-outline"
          />
          <StatCard
            value={`${s.avgDurationMs}ms`}
            label="Avg tool time"
            icon="construct"
          />
          <StatCard
            value={String(totalTokens)}
            label="Tokens"
            icon="send-outline"
          />
        </View>

        <View style={styles.metricRow}>
          <MetricCard
            label="Cache hit rate"
            value={`${cacheHitRate}%`}
            subText={`${s.cacheHits} hits · ${s.cacheMisses} misses`}
            icon="cloud"
          />
          <MetricCard
            label="Steps"
            value={String(s.totalSteps)}
            subText={`~${Math.round((s.totalSteps / Math.max(s.totalTurns, 1)))} per turn`}
            icon="construct"
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>By tool</Text>
          {Object.entries(s.byTool).length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="construct-outline" size={32} color={colors.textFaint} />
              <Text style={styles.emptyText}>No tool calls yet.</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {Object.entries(s.byTool).map(([name, agg]) => {
                const avg = agg.calls > 0 ? Math.round(agg.totalDurationMs / agg.calls) : 0;
                return (
                  <View key={name} style={styles.toolRow}>
                    <Text style={styles.toolName}>{name}</Text>
                    <View style={styles.toolMeta}>
                      <Text style={styles.toolValue}>{agg.calls}x</Text>
                      <Text style={styles.toolValue}>{avg}ms avg</Text>
                      {agg.errors > 0 && (
                        <Text style={styles.toolError}>{agg.errors} error{agg.errors > 1 ? 's' : ''}</Text>
                      )}
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Recent calls</Text>
          {s.recent.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>Abhi koi recent call nahi.</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {s.recent.slice().reverse().map((call, index) => (
                <View key={`${call.toolName}-${index}`} style={styles.recentRow}>
                  <View style={styles.recentIcon}>
                    <Ionicons
                      name="construct-outline"
                      size={14}
                      color={call.success ? colors.success : colors.danger}
                    />
                  </View>
                  <View style={styles.recentText}>
                    <Text style={styles.recentName}>{call.toolName}</Text>
                    <Text style={styles.recentMeta}>
                      {call.durationMs}ms ·
                      {call.tokensIn ? `~${call.tokensIn} in` : ''}
                      {call.tokensOut ? `· ~${call.tokensOut} out` : ''}
                    </Text>
                    {!call.success && (
                      <Text style={styles.recentError}>{call.error ?? 'failed'}</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        <Text style={styles.footer}>
          Telemetry is derived from the append-only event log — no data is sent to any server.
        </Text>
      </ScrollView>
    </View>
  );
}

function StatCard({
  value,
  label,
  icon,
}: {
  value: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.statCard}>
      <View style={styles.statTop}>
        <Text style={styles.statLabel}>{label}</Text>
        <Ionicons name={icon} size={15} color={colors.accent} />
      </View>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function MetricCard({
  label,
  value,
  subText,
  icon,
}: {
  label: string;
  value: string;
  subText: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.metricCard}>
      <View style={styles.metricTop}>
        <Text style={styles.metricLabel}>{label}</Text>
        <Ionicons name={icon} size={15} color={colors.accent} />
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricSub}>{subText}</Text>
    </View>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  glow: {
    position: 'absolute',
    top: -170,
    right: -110,
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: colors.accentSoft,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  statCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    alignItems: 'center',
  },
  statTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  statLabel: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  statValue: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  metricRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  metricCard: {
    flex: 1,
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  metricTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xs,
  },
  metricLabel: {
    color: colors.textFaint,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.2,
  },
  metricValue: {
    color: colors.accent,
    fontSize: 20,
    fontWeight: '700',
  },
  metricSub: {
    color: colors.textFaint,
    fontSize: 10,
    marginTop: 2,
  },
  section: {
    marginTop: spacing.lg,
  },
  sectionLabel: {
    color: colors.textFaint,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
    marginBottom: spacing.xs,
  },
  list: {
    gap: spacing.xs,
  },
  empty: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  toolName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  toolMeta: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  toolValue: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  toolError: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  recentIcon: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentText: {
    flex: 1,
    gap: 2,
  },
  recentName: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  recentMeta: {
    color: colors.textMuted,
    fontSize: 11,
    lineHeight: 16,
  },
  recentError: {
    color: colors.danger,
    fontSize: 11,
    fontWeight: '600',
  },
  footer: {
    color: colors.textFaint,
    fontSize: 11,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
  loading: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
});
