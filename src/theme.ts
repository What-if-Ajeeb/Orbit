import type { ViewStyle } from 'react-native';

/** Raw palette supplied for the light appearance. */
export const palette = {
  cream: '#FDFCFC',
  charcoal: '#302C2C',
  bodyText: '#424245',
  mutedGrey: '#646262',
  stoneGrey: '#6E6E73',
  ashGrey: '#9A9898',
  lightSurface: '#F8F7F7',
  cardBackground: '#F1EEEE',
  accentBlue: '#007AFF',
  successGreen: '#30D158',
  warningOrange: '#FF9F0A',
  dangerRed: '#FF3B30',
} as const;

export const darkColors = {
  background: '#070B14',
  backgroundElevated: '#0B1220',
  surface: '#101A2C',
  surfaceAlt: '#152238',
  border: '#223453',
  borderFocus: '#5B7CFF',
  text: '#F4F7FF',
  textMuted: '#8C9AB8',
  textFaint: '#5D6B88',
  accent: '#6D8BFF',
  accentStrong: '#4E6BFF',
  accentSoft: 'rgba(109, 139, 255, 0.14)',
  success: '#3EE0A1',
  successSoft: 'rgba(62, 224, 161, 0.12)',
  warning: '#FF9F0A',
  warningSoft: 'rgba(255, 159, 10, 0.12)',
  danger: '#FF6B7A',
  dangerSoft: 'rgba(255, 107, 122, 0.12)',
  white: '#FFFFFF',
} as const;

export const lightColors = {
  background: palette.cream,
  backgroundElevated: palette.lightSurface,
  surface: 'rgba(255, 255, 255, 0.72)',
  surfaceAlt: 'rgba(241, 238, 238, 0.92)',
  border: 'rgba(110, 110, 115, 0.22)',
  borderFocus: palette.accentBlue,
  text: palette.charcoal,
  textMuted: palette.stoneGrey,
  textFaint: palette.ashGrey,
  accent: palette.accentBlue,
  accentStrong: '#0067DB',
  accentSoft: 'rgba(0, 122, 255, 0.12)',
  success: palette.successGreen,
  successSoft: 'rgba(48, 209, 88, 0.14)',
  warning: palette.warningOrange,
  warningSoft: 'rgba(255, 159, 10, 0.14)',
  danger: palette.dangerRed,
  dangerSoft: 'rgba(255, 59, 48, 0.12)',
  white: '#FFFFFF',
} as const;

export type AppColors = { [K in keyof typeof darkColors]: string };

export const darkGlass = {
  blurMethod: 'dimezisBlurViewSdk31Plus' as const,
  blurReductionFactor: 5,
  intensity: 64,
  tint: 'dark' as const,
  fill: 'rgba(16, 26, 44, 0.56)',
  fillStrong: 'rgba(9, 15, 27, 0.76)',
  fillSoft: 'rgba(255, 255, 255, 0.05)',
  border: 'rgba(148, 177, 255, 0.18)',
  borderBright: 'rgba(255, 255, 255, 0.14)',
  highlight: 'rgba(255, 255, 255, 0.18)',
  shadow: '#030712',
};

export const lightGlass = {
  ...darkGlass,
  tint: 'light' as const,
  fill: 'rgba(255, 255, 255, 0.62)',
  fillStrong: 'rgba(253, 252, 252, 0.84)',
  fillSoft: 'rgba(48, 44, 44, 0.045)',
  border: 'rgba(48, 44, 44, 0.12)',
  borderBright: 'rgba(255, 255, 255, 0.85)',
  highlight: 'rgba(255, 255, 255, 0.9)',
  shadow: palette.charcoal,
};

export type AppGlass = {
  blurMethod: 'dimezisBlurViewSdk31Plus';
  blurReductionFactor: number;
  intensity: number;
  tint: 'dark' | 'light';
  fill: string;
  fillStrong: string;
  fillSoft: string;
  border: string;
  borderBright: string;
  highlight: string;
  shadow: string;
};

export const darkGlassShadow: ViewStyle = {
  shadowColor: darkGlass.shadow,
  shadowOpacity: 0.4,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 12,
};

export const lightGlassShadow: ViewStyle = {
  shadowColor: lightGlass.shadow,
  shadowOpacity: 0.12,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 8,
};

export type AppShadow = ViewStyle;

// Backwards-compatible aliases. New code should read tokens from the theme
// provider so it follows the selected appearance.
export const colors = darkColors;
export const glass = darkGlass;
export const glassShadow = darkGlassShadow;

export const radius = {
  sm: 10,
  md: 14,
  lg: 20,
  xl: 28,
  pill: 999,
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
} as const;
