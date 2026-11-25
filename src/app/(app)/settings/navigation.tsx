import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { BottomNavigationBar } from '@/components/BottomNavigation';
import { Button } from '@/components/Button';
import { SettingsFeedback } from '@/components/settings/SettingsFeedback';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import { SettingsScreen } from '@/components/settings/SettingsScreen';
import { useBottomNavigation } from '@/context/bottom-navigation';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { BOTTOM_NAV_SLOT_COUNT, type BottomNavDestination } from '@/lib/bottom-navigation';
import { layout, radius, spacing, typography } from '@/theme';

function navIcon(icon: string): keyof typeof Ionicons.glyphMap {
  return icon in Ionicons.glyphMap
    ? (icon as keyof typeof Ionicons.glyphMap)
    : 'extension-puzzle-outline';
}

export default function NavigationSettingsScreen() {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const {
    draftSlots,
    destinations,
    hasChanges,
    setDraftSlot,
    moveDraftSlot,
    saveDraft,
    discardDraft,
    restoreDefaults,
  } = useBottomNavigation();
  const [pickerSlot, setPickerSlot] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (task: () => Promise<void>, success: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      await task();
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update navigation.');
    } finally {
      setBusy(false);
    }
  };

  const selectDestination = (destination: BottomNavDestination) => {
    if (pickerSlot !== null) {
      setDraftSlot(pickerSlot, destination.id);
      setPickerSlot(null);
      setNotice(null);
    }
  };

  return (
    <SettingsScreen
      title="Navigation"
      subtitle={`Choose exactly ${BOTTOM_NAV_SLOT_COUNT} destinations. Everything else stays in the sidebar.`}
      fallback="/settings"
    >
      <SettingsFeedback error={error} notice={notice} onDismissError={() => setError(null)} />

      <SettingsGroup
        title="Bottom bar"
        description="Tap a slot to change it. Use the arrows to reorder."
        footer="Saved destinations are stable IDs. If a plugin is removed or loses access, its slot falls back to a built-in screen until you choose a replacement."
      >
        {draftSlots.map((slot) => (
          <View key={slot.index} style={styles.slotRow} testID={`nav-slot-${slot.index}`}>
            <Ionicons
              name={navIcon(slot.destination.icon)}
              size={19}
              color={colors.accent}
            />

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Change slot ${slot.index + 1}, currently ${slot.destination.label}`}
              android_ripple={{ color: colors.accentSoft }}
              onPress={() => setPickerSlot(slot.index)}
              style={styles.slotCopy}
            >
              <Text style={styles.slotTitle}>
                {slot.index + 1}. {slot.destination.label}
              </Text>
              <Text numberOfLines={2} style={styles.slotDescription}>
                {slot.available
                  ? slot.destination.description
                  : `Saved destination unavailable — using ${slot.destination.label}.`}
              </Text>
            </Pressable>

            <View style={styles.reorder}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Move slot ${slot.index + 1} left`}
                disabled={slot.index === 0 || busy}
                onPress={() => moveDraftSlot(slot.index, slot.index - 1)}
                style={({ pressed }) => [
                  styles.reorderButton,
                  pressed && styles.reorderPressed,
                  (slot.index === 0 || busy) && styles.reorderDisabled,
                ]}
              >
                <Ionicons name="chevron-up-outline" size={17} color={colors.textMuted} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Move slot ${slot.index + 1} right`}
                disabled={slot.index === BOTTOM_NAV_SLOT_COUNT - 1 || busy}
                onPress={() => moveDraftSlot(slot.index, slot.index + 1)}
                style={({ pressed }) => [
                  styles.reorderButton,
                  pressed && styles.reorderPressed,
                  (slot.index === BOTTOM_NAV_SLOT_COUNT - 1 || busy) && styles.reorderDisabled,
                ]}
              >
                <Ionicons name="chevron-down-outline" size={17} color={colors.textMuted} />
              </Pressable>
            </View>
          </View>
        ))}
      </SettingsGroup>

      <SettingsGroup title="Preview" description="This is how the bottom bar will look.">
        <View style={styles.previewWrap}>
          <BottomNavigationBar slots={draftSlots} activePath={null} preview />
        </View>
      </SettingsGroup>

      <View style={styles.actions}>
        <Button
          label="Save"
          loading={busy}
          disabled={!hasChanges}
          onPress={() => void run(saveDraft, 'Navigation saved.')}
        />
        <Button
          label="Discard changes"
          variant="secondary"
          disabled={!hasChanges || busy}
          onPress={() => {
            discardDraft();
            setError(null);
            setNotice(null);
          }}
        />
        <Button
          label="Restore defaults"
          variant="danger"
          disabled={busy}
          onPress={() =>
            void run(restoreDefaults, 'Default navigation restored.')
          }
        />
      </View>

      <Modal
        animationType="slide"
        onRequestClose={() => setPickerSlot(null)}
        transparent
        visible={pickerSlot !== null}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close destination picker"
          onPress={() => setPickerSlot(null)}
          style={styles.modalBackdrop}
        >
          <Pressable style={styles.picker} onPress={() => undefined}>
            <View style={styles.pickerHeader}>
              <Text accessibilityRole="header" style={styles.pickerTitle}>
                Choose destination
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close destination picker"
                onPress={() => setPickerSlot(null)}
                style={styles.closeButton}
              >
                <Ionicons name="close" size={19} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView style={styles.pickerList}>
              {destinations.map((destination) => (
                <Pressable
                  key={destination.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${destination.label}`}
                  android_ripple={{ color: colors.accentSoft }}
                  onPress={() => selectDestination(destination)}
                  style={styles.pickerRow}
                >
                  <Ionicons
                    name={navIcon(destination.icon)}
                    size={18}
                    color={colors.textMuted}
                  />
                  <View style={styles.pickerCopy}>
                    <Text style={styles.pickerRowTitle}>{destination.label}</Text>
                    <Text style={styles.pickerRowDescription}>
                      {destination.source === 'plugin'
                        ? `${destination.description} contribution`
                        : destination.description}
                    </Text>
                  </View>
                  {draftSlots.some(
                    (slot) => slot.destination.id === destination.id
                  ) ? (
                    <Ionicons name="checkmark" size={18} color={colors.accent} />
                  ) : null}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SettingsScreen>
  );
}

const makeStyles = ({ colors, glass }: AppTheme) =>
  StyleSheet.create({
    slotRow: {
      minHeight: 62,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      backgroundColor: colors.surface,
    },
    slotCopy: {
      flex: 1,
      gap: 2,
    },
    slotTitle: {
      color: colors.text,
      ...typography.body,
      fontWeight: '500',
    },
    slotDescription: {
      color: colors.textMuted,
      ...typography.caption,
    },
    reorder: {
      flexDirection: 'row',
      gap: 2,
    },
    reorderButton: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.sm - 4,
      backgroundColor: colors.surfaceAlt,
    },
    reorderPressed: {
      opacity: 0.7,
    },
    reorderDisabled: {
      opacity: 0.35,
    },
    previewWrap: {
      padding: spacing.md,
      backgroundColor: colors.surface,
    },
    actions: {
      gap: spacing.sm,
      paddingBottom: layout.touchTarget + spacing.lg,
    },
    modalBackdrop: {
      flex: 1,
      justifyContent: 'flex-end',
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
    },
    picker: {
      maxHeight: '78%',
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.lg,
      borderTopRightRadius: radius.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: glass.border,
    },
    pickerHeader: {
      minHeight: 54,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
    },
    pickerTitle: {
      color: colors.text,
      ...typography.section,
    },
    closeButton: {
      width: layout.iconButton,
      height: layout.iconButton,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pickerList: {
      maxHeight: 520,
    },
    pickerRow: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm + 2,
      paddingHorizontal: spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: glass.border,
    },
    pickerCopy: {
      flex: 1,
      gap: 1,
    },
    pickerRowTitle: {
      color: colors.text,
      ...typography.body,
    },
    pickerRowDescription: {
      color: colors.textMuted,
      ...typography.caption,
    },
  });
