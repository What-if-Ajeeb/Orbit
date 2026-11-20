import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';



type SidebarButtonProps = {
  onPress: () => void;
  style?: ViewStyle;
};

export function SidebarButton({ onPress, style }: SidebarButtonProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
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

const makeStyles = ({ glass }: AppTheme) =>
  StyleSheet.create({
  button: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: glass.fillStrong,
    borderWidth: 1,
    borderColor: glass.border,
    borderTopColor: glass.borderBright,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
  });
