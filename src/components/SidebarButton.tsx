import { useAppTheme, useStyles, type AppTheme } from '@/context/theme';
import { useTabletLayout } from '@/context/tablet-layout';
import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, type ViewStyle } from 'react-native';



type SidebarButtonProps = {
  onPress: () => void;
  style?: ViewStyle;
};

export function SidebarButton({ onPress, style }: SidebarButtonProps) {
  const { colors } = useAppTheme();
  const styles = useStyles(makeStyles);
  const { layout, toggleSidebar } = useTabletLayout();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={layout.persistentSidebar ? 'Toggle sidebar' : 'Open menu'}
      hitSlop={8}
      onPress={layout.persistentSidebar ? toggleSidebar : onPress}
      style={({ pressed }) => [styles.button, style, pressed && styles.pressed]}
    >
      <Ionicons name="menu" size={22} color={colors.text} />
    </Pressable>
  );
}

const makeStyles = ({ colors }: AppTheme) =>
  StyleSheet.create({
  button: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.75,
  },
  });
