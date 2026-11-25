import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { Bot, Check, GitBranch, Sparkles } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';

import { Button } from '@/components/Button';
import { GlassView } from '@/components/GlassView';
import { SettingsFeedback } from '@/components/settings/SettingsFeedback';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsRow } from '@/components/settings/SettingsRow';
import { SettingsScreen } from '@/components/settings/SettingsScreen';
import { useSession } from '@/context/auth';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import {
  listAgentConfigs,
  saveAgentConfig,
  type AgentConfig,
} from '@/lib/agent-settings';
import { formatRelative } from '@/lib/dates';
import {
  BUILT_IN_AGENTS,
  listDynamicAgents,
} from '@/lib/permissions/agents';
import type { AgentIdentity } from '@/lib/permissions/types';
import { radius, spacing, typography } from '@/theme';

const MEMORY_MAX = 8_000;

function iconFor(agent: AgentIdentity) {
  if (agent.role === 'master') {
    return Sparkles;
  }

  if (agent.role === 'dynamic') {
    return GitBranch;
  }

  return Bot;
}

export default function MemorySettingsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const db = useSQLiteContext();
  const { user } = useSession();
  const [agents, setAgents] = useState<AgentIdentity[]>(BUILT_IN_AGENTS);
  const [configs, setConfigs] = useState<AgentConfig[]>([]);
  const [selectedId, setSelectedId] = useState(BUILT_IN_AGENTS[0]?.id ?? 'master');
  const [memory, setMemory] = useState('');
  const [savedMemory, setSavedMemory] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const [dynamicAgents, nextConfigs] = await Promise.all([
        listDynamicAgents(db, user.id),
        listAgentConfigs(db, user.id),
      ]);
      const allAgents = [...BUILT_IN_AGENTS, ...dynamicAgents];
      const nextId = allAgents.some((agent) => agent.id === selectedId)
        ? selectedId
        : allAgents[0]?.id ?? 'master';
      const value = nextConfigs.find((config) => config.agentId === nextId)?.memory ?? '';

      setAgents(allAgents);
      setConfigs(nextConfigs);
      setSelectedId(nextId);
      setMemory(value);
      setSavedMemory(value);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : 'Agent memory could not be loaded.'
      );
    } finally {
      setLoading(false);
    }
  }, [db, selectedId, user]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  if (!user) {
    return null;
  }

  const activeUser = user;

  if (loading) {
    return <SettingsScreen title="Memory" loading />;
  }

  const selectedAgent =
    agents.find((agent) => agent.id === selectedId) ?? agents[0] ?? null;
  const selectedConfig = configs.find((config) => config.agentId === selectedId);
  const dirty = memory !== savedMemory;

  function selectAgent(agent: AgentIdentity) {
    const value = configs.find((config) => config.agentId === agent.id)?.memory ?? '';

    setSelectedId(agent.id);
    setMemory(value);
    setSavedMemory(value);
    setError(null);
    setNotice(null);
  }

  async function persistMemory(value: string) {
    if (!selectedAgent || saving) {
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      const saved = await saveAgentConfig(db, activeUser.id, selectedAgent.id, {
        memory: value,
      });

      setConfigs((current) => [
        ...current.filter((config) => config.agentId !== saved.agentId),
        saved,
      ]);
      setSavedMemory(saved.memory);
      setMemory(saved.memory);
      setNotice(
        saved.memory
          ? `Memory saved for ${selectedAgent.name}.`
          : `Memory cleared for ${selectedAgent.name}.`
      );
    } catch {
      setError('Could not save memory. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  function confirmClear() {
    if (!selectedAgent || !memory) {
      return;
    }

    Alert.alert(
      'Clear memory?',
      `This removes the saved memory for ${selectedAgent.name}. It cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear',
          style: 'destructive',
          onPress: () => {
            void persistMemory('');
          },
        },
      ]
    );
  }

  return (
    <SettingsScreen
      title="Memory"
      subtitle="Memory is added to the selected agent's context on every turn. Keep it short and useful."
    >
      <SettingsFeedback
        error={error}
        notice={notice}
        onDismissError={() => setError(null)}
      />

      <SettingsGroup
        title="Agent"
        footer="Each agent keeps its own private memory. Memory never crosses between agents."
      >
        {agents.map((agent) => {
          const Icon = iconFor(agent);
          const selected = agent.id === selectedId;

          return (
            <SettingsRow
              key={agent.id}
              icon={Icon}
              title={agent.name}
              description={agent.description}
              showChevron={false}
              onPress={() => selectAgent(agent)}
              right={
                selected ? (
                  <View style={styles.check}>
                    <Check size={16} color={colors.accent} strokeWidth={2.6} />
                  </View>
                ) : undefined
              }
            />
          );
        })}
      </SettingsGroup>

      <GlassView style={styles.card}>
        <View style={styles.editorHeader}>
          <View style={styles.editorCopy}>
            <Text style={styles.editorTitle}>{selectedAgent?.name ?? 'Agent'} memory</Text>
            <Text style={styles.editorDescription}>
              {selectedConfig?.updatedAt
                ? `Last saved ${formatRelative(selectedConfig.updatedAt)}`
                : 'Nothing saved yet.'}
            </Text>
          </View>
          <Text style={styles.counter}>
            {memory.length.toLocaleString()} / {MEMORY_MAX.toLocaleString()}
          </Text>
        </View>

        <TextInput
          value={memory}
          onChangeText={(value) => {
            setMemory(value);
            setNotice(null);
            setError(null);
          }}
          placeholder="e.g. Prefers concise answers. Working on the ORBIT Android app. Always ask before deleting files."
          placeholderTextColor={colors.textFaint}
          accessibilityLabel={`Memory for ${selectedAgent?.name ?? 'agent'}`}
          multiline
          maxLength={MEMORY_MAX}
          selectionColor={colors.accent}
          textAlignVertical="top"
          style={styles.input}
        />

        <View style={styles.actions}>
          <Button
            label="Clear memory"
            variant="secondary"
            onPress={confirmClear}
            disabled={!memory || saving}
            style={styles.flexButton}
          />
          <Button
            label="Save memory"
            onPress={() => {
              void persistMemory(memory);
            }}
            loading={saving}
            disabled={!dirty}
            style={styles.flexButton}
          />
        </View>

        <Text style={styles.note}>
          Memory is stored locally in the app database and is only sent to your configured AI
          provider as part of that agent&apos;s prompt.
        </Text>
      </GlassView>
    </SettingsScreen>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    check: {
      width: 28,
      height: 28,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    card: {
      padding: spacing.md,
      gap: spacing.md,
    },
    editorHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    editorCopy: {
      flex: 1,
      gap: 2,
    },
    editorTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '600',
    },
    editorDescription: {
      color: colors.textMuted,
      ...typography.caption,
    },
    counter: {
      color: colors.textFaint,
      ...typography.caption,
    },
    input: {
      minHeight: 150,
      maxHeight: 280,
      borderRadius: radius.md,
      backgroundColor: colors.surfaceAlt,
      borderWidth: 1,
      borderColor: colors.border,
      color: colors.text,
      ...typography.body,
      padding: spacing.md,
    },
    actions: {
      flexDirection: 'row',
      gap: spacing.sm,
    },
    flexButton: {
      flex: 1,
    },
    note: {
      color: colors.textFaint,
      ...typography.caption,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      paddingTop: spacing.md,
    },
  });
