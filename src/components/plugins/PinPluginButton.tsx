import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet } from 'react-native';

import { usePinnedPlugins } from '@/context/pinned-plugins';
import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { layout, radius } from '@/theme';

type PinPluginButtonProps = {
  pluginId: string;
  label: string;
};

/** Sidebar pin control for a plugin that is already installed. */
export function PinPluginButton({ pluginId, label }: PinPluginButtonProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const { isPinned, togglePin } = usePinnedPlugins();
  const pinned = isPinned(pluginId);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${pinned ? 'Unpin' : 'Pin'} ${label}`}
      accessibilityState={{ selected: pinned }}
      hitSlop={8}
      onPress={() => togglePin(pluginId)}
      style={({ pressed }) => [
        styles.button,
        pinned && styles.buttonPinned,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        name={pinned ? 'star' : 'star-outline'}
        size={18}
        color={pinned ? colors.accent : colors.textMuted}
      />
    </Pressable>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
    button: {
      width: layout.touchTarget - 8,
      height: layout.touchTarget - 8,
      borderRadius: radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceAlt,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    buttonPinned: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accent,
    },
    pressed: {
      opacity: 0.72,
    },
  });
