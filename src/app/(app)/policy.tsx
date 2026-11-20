import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { SidebarButton } from '@/components/SidebarButton';
import { useSidebar } from '@/context/sidebar';
import { policyEngine, type PolicyDecision, type ToolPolicyRule } from '@/lib/policy';
import { colors, radius, spacing } from '@/theme';

const DECISION_META: Record<PolicyDecision, { label: string; color: string }> = {
  allow: { label: 'ALLOW', color: colors.success },
  deny: { label: 'DENY', color: colors.danger },
  ask: { label: 'ASK', color: colors.accent },
};

export default function PolicyScreen() {
  const insets = useSafeAreaInsets();
  const { open: openSidebar } = useSidebar();
  const [rules, setRules] = useState<ToolPolicyRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRules(policyEngine.listRules());
    } catch (loadError) {
      console.warn('Could not load policy rules.', loadError);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const toggleRule = async (id: string, enabled: boolean) => {
    setNotice(null);
    policyEngine.setRuleEnabled(id, enabled);
    setRules(policyEngine.listRules());
    setNotice(
      enabled ? 'Rule enabled.' : 'Rule disabled. It will no longer apply.'
    );
  };

  const resetDefaults = async () => {
    Alert.alert(
      'Reset all policy rules?',
      'Built-in rules will be restored and any customizations removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            policyEngine.restoreDefaults();
            setRules(policyEngine.listRules());
            setNotice('Policy rules reset to defaults.');
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

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
          eyebrow="POLICY"
          title="Approval gates"
          subtitle="Every tool call passes through configurable gates before executing."
          left={<SidebarButton onPress={openSidebar} />}
        />

        {notice ? (
          <View style={styles.notice}>
            <Ionicons name="information-circle" size={15} color={colors.accent} />
            <Text style={styles.noticeText}>{notice}</Text>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          onPress={resetDefaults}
          style={({ pressed }) => [
            styles.resetButton,
            pressed && styles.pressedButton,
          ]}
        >
          <Ionicons name="refresh" size={15} color={colors.accent} />
          <Text style={styles.resetText}>Reset to defaults</Text>
        </Pressable>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>
            Rules ({rules.length})
          </Text>

          {rules.length === 0 ? (
            <View style={styles.empty}>
              <Text style={styles.emptyText}>No policy rules configured.</Text>
            </View>
          ) : (
            <View style={styles.list}>
              {rules.map((rule) => (
                <View key={rule.id} style={styles.ruleRow}>
                  <View style={styles.ruleMain}>
                    <View style={styles.ruleText}>
                      <Text style={styles.ruleName}>{rule.name}</Text>
                      <Text style={styles.ruleDesc}>{rule.description}</Text>
                    </View>
                    <View style={styles.ruleRight}>
                      <View
                      style={[
                        styles.decisionChip,
                        {
                          backgroundColor:
                            DECISION_META[rule.decision].color === colors.success
                              ? colors.successSoft
                              : DECISION_META[rule.decision].color ===
                                colors.danger
                              ? colors.dangerSoft
                              : colors.accentSoft,
                          borderColor:
                            DECISION_META[rule.decision].color === colors.success
                              ? 'rgba(62, 224, 161, 0.35)'
                              : DECISION_META[rule.decision].color ===
                                colors.danger
                              ? 'rgba(255, 107, 122, 0.35)'
                              : 'rgba(109, 139, 255, 0.35)',
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.decisionText,
                          { color: DECISION_META[rule.decision].color },
                        ]}
                      >
                        {DECISION_META[rule.decision].label}
                      </Text>
                    </View>
                      <Switch
                        accessibilityLabel={`Toggle ${rule.name}`}
                        value={rule.enabled}
                        onValueChange={(enabled) => toggleRule(rule.id, enabled)}
                        trackColor={{
                          false: colors.border,
                          true: 'rgba(62, 224, 161, 0.4)',
                        }}
                        thumbColor={rule.enabled ? colors.success : colors.textMuted}
                        ios_backgroundColor={colors.border}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>

        <Text style={styles.footer}>
          Policy rules live on this device in SecureStore. Ask rules pause the
          agent and wait for your approval before executing.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
  notice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    backgroundColor: colors.accentSoft,
    borderWidth: 1,
    borderColor: 'rgba(109, 139, 255, 0.3)',
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    marginTop: spacing.lg,
  },
  noticeText: {
    flex: 1,
    color: colors.accent,
    fontSize: 13,
    lineHeight: 19,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'rgba(109, 139, 255, 0.3)',
    backgroundColor: colors.accentSoft,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
  },
  resetText: {
    color: colors.accent,
    fontSize: 13,
    fontWeight: '600',
  },
  pressedButton: {
    opacity: 0.78,
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
  ruleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 3,
    paddingHorizontal: spacing.md,
  },
  ruleMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  ruleText: {
    flex: 1,
    gap: 2,
  },
  ruleName: {
    color: colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  ruleDesc: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  ruleRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  decisionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  decisionText: {
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
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
