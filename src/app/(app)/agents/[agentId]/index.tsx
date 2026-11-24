import { useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AgentChatView } from '@/components/AgentChatView';
import { EmptyState } from '@/components/EmptyState';
import { GlassBackdrop } from '@/components/GlassBackdrop';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { useSession } from '@/context/auth';
import { useSidebar } from '@/context/sidebar';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { resolveAgentIdentity } from '@/lib/permissions/agents';
import type { AgentIdentity } from '@/lib/permissions';
import { spacing } from '@/theme';

export default function AgentChatScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { user } = useSession();
  const { open: openSidebar } = useSidebar();
  const params = useLocalSearchParams<{ agentId?: string }>();
  const rawId = params.agentId;
  const agentId = typeof rawId === 'string' ? decodeURIComponent(rawId) : '';
  const [agent, setAgent] = useState<AgentIdentity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !agentId) {
      return;
    }

    let active = true;

    void resolveAgentIdentity(db, user.id, agentId)
      .then((found) => {
        if (active) {
          setAgent(found);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [agentId, db, user]);

  if (!user) {
    return null;
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (!agent) {
    return (
      <View style={styles.root}>
        <GlassBackdrop />
        <View style={styles.header}>
          <ScreenHeader title="Agent not found" left={<SidebarButton onPress={openSidebar} />} />
        </View>
        <EmptyState
          icon="alert-circle-outline"
          title="No agent with this ID"
          message="It may have been removed from this device."
        />
      </View>
    );
  }

  return <AgentChatView agent={agent} agentId={agent.id} />;
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    centered: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.background,
    },
    header: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xl,
    },
  });
