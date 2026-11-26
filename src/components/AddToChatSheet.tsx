import Ionicons from '@expo/vector-icons/Ionicons';
import { BottomSheet, RNHostView } from '@expo/ui';
import { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { MAX_ATTACHMENTS } from '@/lib/chat-attachments';
import type { ChatProjectScope } from '@/lib/project-scopes';
import { fonts, radius, spacing } from '@/theme';

type AddToChatSheetProps = {
  visible: boolean;
  onClose: () => void;
  onCamera: () => void;
  onPhotos: () => void;
  onFiles: () => void;
  projectScopes: ChatProjectScope[];
  selectedProject: ChatProjectScope | null;
  onSelectProject: (scope: ChatProjectScope | null) => void;
  webSearchEnabled: boolean;
  onToggleWebSearch: (enabled: boolean) => void;
  onOpenConnectors: () => void;
  attachmentCount: number;
};

type SheetView = 'main' | 'project';

export function AddToChatSheet({
  visible,
  onClose,
  onCamera,
  onPhotos,
  onFiles,
  projectScopes,
  selectedProject,
  onSelectProject,
  webSearchEnabled,
  onToggleWebSearch,
  onOpenConnectors,
  attachmentCount,
}: AddToChatSheetProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const [view, setView] = useState<SheetView>('main');

  const attachmentsFull = attachmentCount >= MAX_ATTACHMENTS;

  function close() {
    setView('main');
    onClose();
  }

  function chooseProject(scope: ChatProjectScope | null) {
    onSelectProject(scope);
    setView('main');
  }

  const cards = [
    {
      label: 'Camera',
      icon: 'camera-outline' as const,
      onPress: onCamera,
    },
    {
      label: 'Photos',
      icon: 'images-outline' as const,
      onPress: onPhotos,
    },
    {
      label: 'Files',
      icon: 'document-text-outline' as const,
      onPress: onFiles,
    },
  ];

  return (
    <BottomSheet
      testID="add-to-chat-sheet"
      isPresented={visible}
      onDismiss={close}
      shouldDismissOnBackPress
      shouldDismissOnClickOutside
      snapPoints={['half', 'full']}
      showDragIndicator
      contentPadding={{ top: 0, right: 0, bottom: 0, left: 0 }}
      containerColor={colors.surface}
      contentColor={colors.text}
    >
      <RNHostView>
        <View style={styles.host}>
          <View style={styles.header}>
            <View style={styles.headerLeading}>
              {view === 'project' ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Back to add to chat"
                  hitSlop={8}
                  onPress={() => setView('main')}
                  style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
                >
                  <Ionicons name="arrow-back" size={20} color={colors.textMuted} />
                </Pressable>
              ) : null}
              <Text accessibilityRole="header" style={styles.title}>
                {view === 'project' ? 'Add to project' : 'Add to chat'}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close add to chat"
              hitSlop={8}
              onPress={close}
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </Pressable>
          </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, spacing.lg) },
          ]}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          showsVerticalScrollIndicator={false}
        >
          {view === 'main' ? (
            <>
              <View style={styles.cardRow}>
                {cards.map((card) => (
                  <Pressable
                    key={card.label}
                    accessibilityRole="button"
                    accessibilityLabel={card.label}
                    accessibilityState={{ disabled: attachmentsFull }}
                    disabled={attachmentsFull}
                    onPress={card.onPress}
                    style={({ pressed }) => [
                      styles.card,
                      attachmentsFull && styles.cardDisabled,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.cardIcon}>
                      <Ionicons name={card.icon} size={22} color={colors.accent} />
                    </View>
                    <Text style={styles.cardLabel}>{card.label}</Text>
                  </Pressable>
                ))}
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add to project"
                onPress={() => setView('project')}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="folder-outline" size={20} color={colors.textMuted} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Add to project</Text>
                  <Text numberOfLines={1} style={styles.rowSubtitle}>
                    {selectedProject?.label ?? 'None'}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              </Pressable>

              <View style={styles.row}>
                <View style={styles.rowIcon}>
                  <Ionicons name="globe-outline" size={20} color={colors.textMuted} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Web Search</Text>
                  <Text style={styles.rowSubtitle}>
                    {webSearchEnabled ? 'Allowed for this chat' : 'Off — no automatic web search'}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Web Search"
                  value={webSearchEnabled}
                  onValueChange={onToggleWebSearch}
                  trackColor={{ false: colors.surfaceAlt, true: colors.accentSoft }}
                  thumbColor={webSearchEnabled ? colors.accent : colors.textFaint}
                  ios_backgroundColor={colors.surfaceAlt}
                />
              </View>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Connectors"
                onPress={onOpenConnectors}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.rowIcon}>
                  <Ionicons name="link-outline" size={20} color={colors.textMuted} />
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>Connectors</Text>
                  <Text style={styles.rowSubtitle}>Accounts, plugins and MCP servers</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
              </Pressable>

              <Text style={styles.footerHint}>
                Up to {MAX_ATTACHMENTS} files per message. Everything stays on this device.
              </Text>
            </>
          ) : (
            <>
              {[
                { scope: null, title: 'None', subtitle: 'No project attached' },
                ...projectScopes.map((scope) => ({
                  scope,
                  title: scope.label,
                  subtitle: scope.source === 'workflow' ? 'Existing workflow' : 'Existing scope',
                })),
              ].map((option) => {
                const selected =
                  option.scope === null
                    ? selectedProject === null
                    : selectedProject?.id === option.scope.id;

                return (
                  <Pressable
                    key={option.scope?.id ?? 'none'}
                    accessibilityRole="button"
                    accessibilityLabel={`Select ${option.title}`}
                    accessibilityState={{ selected }}
                    onPress={() => chooseProject(option.scope)}
                    style={({ pressed }) => [
                      styles.row,
                      selected && styles.rowSelected,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={styles.rowIcon}>
                      <Ionicons
                        name={option.scope === null ? 'remove-circle-outline' : 'folder-outline'}
                        size={20}
                        color={selected ? colors.accent : colors.textMuted}
                      />
                    </View>
                    <View style={styles.rowText}>
                      <Text style={[styles.rowTitle, selected && styles.rowTitleSelected]}>
                        {option.title}
                      </Text>
                      <Text style={styles.rowSubtitle}>{option.subtitle}</Text>
                    </View>
                    {selected ? (
                      <Ionicons name="checkmark" size={18} color={colors.accent} />
                    ) : null}
                  </Pressable>
                );
              })}
            </>
          )}
          </ScrollView>
        </View>
      </RNHostView>
    </BottomSheet>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    host: {
      flex: 1,
      backgroundColor: colors.surface,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    headerLeading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
    },
    title: {
      color: colors.text,
      fontFamily: fonts.serif,
      fontSize: 20,
      fontWeight: '600',
      letterSpacing: -0.2,
    },
    closeButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
    },
    backButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    scroll: {
      flex: 1,
    },
    content: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md,
      gap: spacing.sm,
    },
    cardRow: {
      flexDirection: 'row',
      gap: spacing.sm,
      marginBottom: spacing.xs,
    },
    card: {
      flex: 1,
      minHeight: 104,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.md,
    },
    cardDisabled: {
      opacity: 0.45,
    },
    cardIcon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cardLabel: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      minHeight: 64,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surfaceAlt,
    },
    rowSelected: {
      borderColor: colors.accent,
    },
    rowIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowText: {
      flex: 1,
      gap: 2,
    },
    rowTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    rowTitleSelected: {
      color: colors.accent,
    },
    rowSubtitle: {
      color: colors.textFaint,
      fontSize: 12,
    },
    footerHint: {
      color: colors.textFaint,
      fontSize: 12,
      textAlign: 'center',
      paddingTop: spacing.sm,
    },
    pressed: {
      opacity: 0.8,
    },
  });
