import { View } from 'react-native';

import { colors } from '@/theme';

type BrandProps = {
  size?: number;
};

/**
 * A tiny planet + ring mark drawn with plain views, so it stays crisp at any
 * size without extra icon/font assets.
 */
export function Brand({ size = 56 }: BrandProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View
        style={{
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: colors.accentSoft,
          borderWidth: 1,
          borderColor: 'rgba(109, 139, 255, 0.28)',
        }}
      />
      <View
        style={{
          width: size * 0.4,
          height: size * 0.4,
          borderRadius: size * 0.2,
          backgroundColor: colors.accent,
        }}
      />
      <View
        style={{
          position: 'absolute',
          width: size * 0.88,
          height: size * 0.3,
          borderRadius: size * 0.15,
          borderWidth: Math.max(1.5, size * 0.035),
          borderColor: colors.accent,
          transform: [{ rotate: '-20deg' }],
          opacity: 0.85,
        }}
      />
    </View>
  );
}
