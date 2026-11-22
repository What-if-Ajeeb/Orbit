import { MD3DarkTheme, MD3LightTheme, PaperProvider } from 'react-native-paper';
import type { PropsWithChildren } from 'react';
import { useMemo } from 'react';

import { useAppTheme } from '@/context/theme';

export function PaperThemeBridge({ children }: PropsWithChildren) {
  const { colors, isLight } = useAppTheme();

  const theme = useMemo(() => {
    const base = isLight ? MD3LightTheme : MD3DarkTheme;
    return {
      ...base,
      roundness: 14,
      colors: {
        ...base.colors,
        primary: colors.accent,
        onPrimary: colors.white,
        primaryContainer: colors.accentSoft,
        onPrimaryContainer: colors.accent,
        secondary: colors.textMuted,
        onSecondary: colors.text,
        secondaryContainer: colors.surfaceAlt,
        onSecondaryContainer: colors.text,
        background: colors.background,
        onBackground: colors.text,
        surface: colors.surface,
        onSurface: colors.text,
        surfaceVariant: colors.surfaceAlt,
        onSurfaceVariant: colors.textMuted,
        outline: colors.border,
        outlineVariant: colors.border,
        error: colors.danger,
        onError: colors.white,
        errorContainer: colors.dangerSoft,
        onErrorContainer: colors.danger,
        elevation: {
          ...base.colors.elevation,
          level0: colors.background,
          level1: colors.surface,
          level2: colors.surfaceAlt,
          level3: colors.surfaceAlt,
          level4: colors.surfaceAlt,
          level5: colors.surfaceAlt,
        },
      },
    };
  }, [colors, isLight]);

  return <PaperProvider theme={theme}>{children}</PaperProvider>;
}
