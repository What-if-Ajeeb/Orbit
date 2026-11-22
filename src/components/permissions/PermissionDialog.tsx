import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Brand } from '@/components/Brand';
import { Button } from '@/components/Button';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { formatRelative } from '@/lib/dates';
import {
  CATEGORY_META,
  RISK_META,
  categoryLabel,
  type PermissionDecisionOption,
  type PermissionRequestRecord,
  type RiskLevel,
} from '@/lib/permissions';
import { radius, spacing } from '@/theme';

type IconName = keyof typeof Ionicons.glyphMap;

type PermissionDialogProps = {
  request: PermissionRequestRecord;
  queued: number;
  busy: PermissionDecisionOption | null;
  error: string | null;
  onResolve: (option: PermissionDecisionOption) => void;
  onCancel: () => void;
};

const ROLE_LABELS: Record<PermissionRequestRecord['agentRole'], string> = {
  master: 'Master agent',
  specialist: 'Specialist agent',
  dynamic: 'Dynamic agent',
};

function iconOrFallback(name: string): IconName {
  return name in Ionicons.glyphMap ? (name as IconName) : 'sparkles';
}

function riskColor(risk: RiskLevel, colors: AppTheme['colors']): string {
  if (risk === 'high') {
    return colors.danger;
  }

  if (risk === 'medium') {
    return colors.warning;
  }

  return colors.success;
}

function riskSoftColor(risk: RiskLevel, colors: AppTheme['colors']): string {
  if (risk === 'high') {
    return colors.dangerSoft;
  }

  if (risk === 'medium') {
    return colors.warningSoft;
  }

  return colors.successSoft;
}

export function PermissionDialog({
  request,
  queued,
  busy,
  error,
  onResolve,
  onCancel,
}: PermissionDialogProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const progress = useState(() => new Animated.Value(0))[0];
  const canAlways = request.allowAlways && request.risk !== 'high';
  const disabled = busy !== null;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [26, 0],
  });
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.96, 1],
  });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onCancel}
      accessibilityViewIsModal
    >
      <View style={styles.overlay}>
        <Animated.View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}
        >
        </Animated.View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel permission request"
          onPress={disabled ? undefined : onCancel}
          style={StyleSheet.absoluteFill}
        />

        <Animated.View
          style={[
            styles.card,
            {
              width: Math.min(width - spacing.lg * 2, 460),
              maxHeight: height - insets.top - insets.bottom - spacing.xl,
              marginTop: insets.top + spacing.md,
              marginBottom: insets.bottom + spacing.md,
              opacity: progress,
              transform: [{ translateY }, { scale }],
            },
          ]}
        >
          <View pointerEvents="none" style={styles.topGlow} />
          <View pointerEvents="none" style={styles.highlight} />

          <View style={styles.brandRow}>
            <Brand size={36} />
            <View style={styles.brandText}>
              <Text style={styles.wordmark}>ORBIT</Text>
              <Text style={styles.eyebrow}>PERMISSION REQUEST</Text>
            </View>

            {queued > 1 ? (
              <View style={styles.queuePill}>
                <Text style={styles.queueText}>1 of {queued}</Text>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel permission request"
              disabled={disabled}
              hitSlop={10}
              onPress={onCancel}
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.pressed,
                disabled && styles.disabled,
              ]}
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={styles.scrollContent}
          >
            <View style={styles.agentRow}>
              <View style={styles.agentIcon}>
                <Ionicons
                  name={iconOrFallback(request.agentRole === 'master' ? 'planet' : 'sparkles')}
                  size={21}
                  color={colors.accent}
                />
              </View>
              <View style={styles.agentText}>
                <Text style={styles.agentName}>{request.agentName}</Text>
                <Text style={styles.agentMeta}>
                  {ROLE_LABELS[request.agentRole]} · wants to act
                </Text>
              </View>
              <View
                style={[
                  styles.riskBadge,
                  { backgroundColor: riskSoftColor(request.risk, colors) },
                ]}
              >
                <View
                  style={[
                    styles.riskDot,
                    { backgroundColor: riskColor(request.risk, colors) },
                  ]}
                />
                <Text
                  style={[
                    styles.riskText,
                    { color: riskColor(request.risk, colors) },
                  ]}
                >
                  {RISK_META[request.risk].shortLabel}
                </Text>
              </View>
            </View>

            <Text style={styles.title}>{request.title}</Text>
            <Text style={styles.summary}>{request.summary}</Text>

            <View style={styles.metaRow}>
              <View style={styles.categoryChip}>
                <Ionicons
                  name={iconOrFallback(CATEGORY_META[request.category].icon)}
                  size={13}
                  color={colors.accent}
                />
                <Text style={styles.categoryText}>{categoryLabel(request.category)}</Text>
              </View>
              <Text style={styles.expiryText}>Expires {formatRelative(request.expiresAt)}</Text>
            </View>

            <View style={styles.previewCard}>
              <Text style={styles.sectionLabel}>WHAT WILL HAPPEN</Text>
              {request.actions.map((action, index) => (
                <View key={`${request.id}-action-${index}`} style={styles.actionRow}>
                  <View style={styles.bullet} />
                  <Text style={styles.actionText}>{action}</Text>
                </View>
              ))}

              {request.commandPreview ? (
                <View style={styles.commandBox}>
                  <View style={styles.commandHeader}>
                    <Ionicons name="terminal-outline" size={13} color={colors.warning} />
                    <Text style={styles.commandLabel}>COMMAND PREVIEW</Text>
                  </View>
                  <Text selectable style={styles.commandText}>
                    {request.commandPreview}
                  </Text>
                </View>
              ) : null}
            </View>

            <View style={styles.detailGrid}>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Target</Text>
                <Text style={styles.detailValue}>
                  {request.target.label}
                  {request.target.detail ? ` · ${request.target.detail}` : ''}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Project</Text>
                <Text style={styles.detailValue}>{request.projectLabel}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Scope</Text>
                <Text style={styles.detailValue}>
                  This agent only · {request.toolName} · {categoryLabel(request.category)}
                </Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Why</Text>
                <Text style={styles.detailValue}>{request.reason}</Text>
              </View>
            </View>

            {request.risk === 'high' ? (
              <View style={styles.warningRow}>
                <Ionicons name="shield-half-outline" size={15} color={colors.danger} />
                <Text style={styles.warningText}>
                  High-risk actions ask every time. “Always allow” can never be saved for this
                  request.
                </Text>
              </View>
            ) : null}

            {error ? (
              <View style={styles.errorRow}>
                <Ionicons name="alert-circle-outline" size={15} color={colors.danger} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <Button
              label="Allow once"
              onPress={() => onResolve('allow_once')}
              loading={busy === 'allow_once'}
              disabled={disabled}
            />
            <Button
              label={canAlways ? 'Always allow' : 'Always allow · locked'}
              variant="secondary"
              onPress={() => onResolve('always_allow')}
              loading={busy === 'always_allow'}
              disabled={disabled || !canAlways}
            />
            <Button
              label="Deny"
              variant="danger"
              onPress={() => onResolve('deny')}
              loading={busy === 'deny'}
              disabled={disabled}
            />
            <Text style={styles.footnote}>
              {canAlways
                ? '“Always allow” saves a 30-day grant for this exact agent, tool, project, and category. You can revoke it in Agent Permissions.'
                : 'Only this one run will be authorized. Orbit never executes before your decision.'}
            </Text>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
    overlay: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing.lg,
    },
    backdrop: {
      backgroundColor: 'rgba(3, 6, 12, 0.58)',
    },
    card: {
      overflow: 'hidden',
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: glass.border,
      borderTopColor: glass.borderBright,
      backgroundColor: glass.fillStrong,
      shadowColor: '#000000',
      shadowOpacity: 0.52,
      shadowRadius: 30,
      shadowOffset: { width: 0, height: 18 },
      elevation: 30,
    },
    topGlow: {
      position: 'absolute',
      top: -120,
      right: -80,
      width: 240,
      height: 240,
      borderRadius: 120,
      backgroundColor: colors.accentSoft,
    },
    highlight: {
      position: 'absolute',
      top: 0,
      left: '10%',
      right: '10%',
      height: 1,
      backgroundColor: glass.highlight,
    },
    brandRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingHorizontal: spacing.md + 2,
      paddingTop: spacing.md + 2,
      paddingBottom: spacing.sm,
    },
    brandText: {
      flex: 1,
      gap: 1,
    },
    wordmark: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
      letterSpacing: 4,
    },
    eyebrow: {
      color: colors.accent,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 1.7,
    },
    queuePill: {
      borderRadius: radius.pill,
      backgroundColor: colors.accentSoft,
      paddingHorizontal: spacing.sm,
      paddingVertical: 4,
    },
    queueText: {
      color: colors.accent,
      fontSize: 10,
      fontWeight: '700',
    },
    closeButton: {
      width: 32,
      height: 32,
      borderRadius: 11,
      backgroundColor: glass.fillSoft,
      borderWidth: 1,
      borderColor: glass.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scrollContent: {
      paddingHorizontal: spacing.md + 2,
      paddingBottom: spacing.sm,
      gap: spacing.sm + 2,
    },
    agentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: glass.border,
      borderTopColor: glass.borderBright,
      backgroundColor: glass.fillSoft,
      padding: spacing.sm,
    },
    agentIcon: {
      width: 42,
      height: 42,
      borderRadius: 14,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    agentText: {
      flex: 1,
      gap: 2,
    },
    agentName: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    agentMeta: {
      color: colors.textMuted,
      fontSize: 11,
    },
    riskBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
    },
    riskDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    riskText: {
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.9,
    },
    title: {
      color: colors.text,
      fontSize: 21,
      fontWeight: '700',
      letterSpacing: -0.3,
      lineHeight: 27,
    },
    summary: {
      color: colors.textMuted,
      fontSize: 13,
      lineHeight: 19,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
    },
    categoryChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.fillSoft,
      paddingHorizontal: spacing.sm,
      paddingVertical: 5,
    },
    categoryText: {
      color: colors.accent,
      fontSize: 10,
      fontWeight: '700',
    },
    expiryText: {
      color: colors.textFaint,
      fontSize: 10,
    },
    previewCard: {
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: glass.border,
      backgroundColor: glass.fillSoft,
      padding: spacing.sm + 2,
    },
    sectionLabel: {
      color: colors.textFaint,
      fontSize: 9,
      fontWeight: '700',
      letterSpacing: 1.5,
    },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    bullet: {
      width: 5,
      height: 5,
      borderRadius: 3,
      marginTop: 7,
      backgroundColor: colors.accent,
    },
    actionText: {
      flex: 1,
      color: colors.text,
      fontSize: 13,
      lineHeight: 19,
    },
    commandBox: {
      gap: spacing.xs,
      borderRadius: radius.sm,
      borderWidth: 1,
      borderColor: colors.warning,
      backgroundColor: colors.warningSoft,
      padding: spacing.sm,
    },
    commandHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    commandLabel: {
      color: colors.warning,
      fontSize: 8,
      fontWeight: '800',
      letterSpacing: 1.2,
    },
    commandText: {
      color: colors.text,
      fontSize: 12,
      lineHeight: 17,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    },
    detailGrid: {
      gap: spacing.xs + 1,
    },
    detailRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    detailLabel: {
      width: 62,
      color: colors.textFaint,
      fontSize: 11,
      fontWeight: '600',
      paddingTop: 1,
    },
    detailValue: {
      flex: 1,
      color: colors.textMuted,
      fontSize: 12,
      lineHeight: 17,
    },
    warningRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
      padding: spacing.sm,
    },
    warningText: {
      flex: 1,
      color: colors.danger,
      fontSize: 11,
      lineHeight: 16,
    },
    errorRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.danger,
      backgroundColor: colors.dangerSoft,
      padding: spacing.sm,
    },
    errorText: {
      flex: 1,
      color: colors.danger,
      fontSize: 12,
      lineHeight: 17,
    },
    actions: {
      gap: spacing.xs + 2,
      padding: spacing.md + 2,
      paddingTop: spacing.sm,
      borderTopWidth: 1,
      borderTopColor: glass.border,
    },
    footnote: {
      color: colors.textFaint,
      fontSize: 10,
      lineHeight: 14,
      textAlign: 'center',
      paddingTop: 2,
    },
    pressed: {
      opacity: 0.78,
    },
    disabled: {
      opacity: 0.5,
    },
  });
