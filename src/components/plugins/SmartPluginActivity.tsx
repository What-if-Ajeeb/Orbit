import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GlassView } from '@/components/GlassView';
import { usePluginPlatform, usePluginSnapshot } from '@/context/plugins';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  DEMAND_CAPABILITY_LABEL,
  emptySmartPluginState,
  type SmartPluginState,
} from '@/lib/plugins/demand';
import { getSmartPluginInstaller } from '@/lib/plugins/demand-runtime';
import { radius, spacing } from '@/theme';

function shortTime(timestamp: number): string {
  const date = new Date(timestamp);

  return Number.isNaN(date.getTime())
    ? 'unknown'
    : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Read-only view of demand history plus an explicit disable-unused control. */
export function SmartPluginActivity() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const platform = usePluginPlatform();
  const snapshotVersion = usePluginSnapshot().version;
  const [state, setState] = useState<SmartPluginState | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const installer = getSmartPluginInstaller(platform);
    setState(installer ? await installer.getState() : emptySmartPluginState());
  }, [platform]);

  useEffect(() => {
    queueMicrotask(() => {
      void refresh();
    });
  }, [refresh, snapshotVersion]);

  if (!state || (Object.keys(state.autoInstalled).length === 0 && state.usage.length === 0)) {
    return null;
  }

  const autoCount = Object.keys(state.autoInstalled).length;

  return (
    <GlassView style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>On-demand plugins</Text>
          <Text style={styles.subtitle}>
            {autoCount} installed by request · {state.usage.length} recorded action(s)
          </Text>
        </View>
      </View>

      <View style={styles.history}>
        {state.usage
          .slice(-4)
          .reverse()
          .map((record, index) => (
            <Text key={`${record.createdAt}-${record.pluginId}-${index}`} style={styles.row}>
              · {shortTime(record.createdAt)} {record.status} · {record.pluginId} ·{' '}
              {DEMAND_CAPABILITY_LABEL[record.capability]}
            </Text>
          ))}
      </View>

      <Text style={styles.note}>
        Auto-installed plugins may be disabled when unused, but ORBIT never uninstalls a plugin
        for you.
      </Text>

      <Pressable
        accessibilityRole="button"
        disabled={busy || autoCount === 0}
        onPress={() => {
          setBusy(true);
          void (async () => {
            try {
              const installer = getSmartPluginInstaller(platform);
              await installer?.disableUnused();
              await refresh();
            } finally {
              setBusy(false);
            }
          })();
        }}
        style={({ pressed }) => [
          styles.button,
          (busy || autoCount === 0) && styles.buttonDisabled,
          pressed && styles.pressed,
        ]}
      >
        <Text style={styles.buttonText}>{busy ? 'Checking…' : 'Disable unused auto plugins'}</Text>
      </Pressable>
    </GlassView>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
    card: {
      padding: spacing.md,
      gap: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.fillSoft,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    iconWrap: {
      width: 32,
      height: 32,
      borderRadius: radius.md,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerCopy: {
      flex: 1,
      gap: 2,
    },
    title: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    subtitle: {
      color: colors.textMuted,
      fontSize: 11,
    },
    history: {
      gap: 2,
    },
    row: {
      color: colors.textMuted,
      fontSize: 11,
      lineHeight: 16,
    },
    note: {
      color: colors.textFaint,
      fontSize: 10,
      lineHeight: 15,
    },
    button: {
      alignSelf: 'flex-start',
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: glass.border,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
    },
    buttonDisabled: {
      opacity: 0.5,
    },
    pressed: {
      opacity: 0.7,
    },
    buttonText: {
      color: colors.accent,
      fontSize: 11,
      fontWeight: '700',
    },
  });
