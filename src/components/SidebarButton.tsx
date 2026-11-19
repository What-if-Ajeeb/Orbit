import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

type SidebarButtonProps = {
  onPress: () => void;
  style?: ViewStyle;
};

export function SidebarButton({ onPress, style }: SidebarButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open menu"
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [styles.button, style, pressed && styles.pressed]}
    >
      <Ionicons name="menu" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: 'rgba(16, 26, 44, 0.68)',
    borderWidth: 1,
    borderColor: 'rgba(148, 177, 255, 0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
});
