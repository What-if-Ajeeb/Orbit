import { BlurView } from 'expo-blur';
import type { PropsWithChildren } from 'react';
import {
  Pressable,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { glass, glassShadow, radius } from '@/theme';

type GlassVariant = 'card' | 'panel' | 'pill' | 'bar';

type GlassViewProps = PropsWithChildren<{
  style?: StyleProp<ViewStyle>;
  variant?: GlassVariant;
  intensity?: number;
  bordered?: boolean;
  highlight?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}>;

const variantStyle: Record<GlassVariant, ViewStyle> = {
  card: {
    borderRadius: radius.lg,
    backgroundColor: glass.fill,
  },
  panel: {
    borderRadius: radius.xl,
    backgroundColor: glass.fillStrong,
  },
  pill: {
    borderRadius: radius.pill,
    backgroundColor: glass.fillSoft,
  },
  bar: {
    backgroundColor: glass.fillStrong,
  },
};

/**
 * Frosted surface used for large UI blocks. Children sit above the blur, so
 * existing padding, gaps, and layout styles keep working unchanged.
 */
export function GlassView({
  children,
  style,
  variant = 'card',
  intensity = glass.intensity,
  bordered = true,
  highlight = true,
  onPress,
  disabled = false,
  accessibilityLabel,
}: GlassViewProps) {
  const layers = (
    <>
      <BlurView
        intensity={intensity}
        tint={glass.tint}
        blurMethod={glass.blurMethod}
        blurReductionFactor={glass.blurReductionFactor}
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
      />
      {highlight ? <View pointerEvents="none" style={styles.highlight} /> : null}
      {children}
    </>
  );

  const surfaceStyle = [
    styles.base,
    variantStyle[variant],
    bordered && styles.bordered,
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [...surfaceStyle, pressed && styles.pressed]}
      >
        {layers}
      </Pressable>
    );
  }

  return <View style={surfaceStyle}>{layers}</View>;
}

const styles = StyleSheet.create({
  base: {
    ...glassShadow,
    overflow: 'hidden',
  },
  bordered: {
    borderWidth: 1,
    borderColor: glass.border,
    borderTopColor: glass.borderBright,
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: '12%',
    right: '12%',
    height: 1,
    backgroundColor: glass.highlight,
  },
  pressed: {
    opacity: 0.82,
  },
});
