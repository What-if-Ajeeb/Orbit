import type { ViewStyle } from 'react-native';

/**
 * ORBIT Design System
 * Extracted from professional UI mock (Home / Loading / Empty / Error / Success).
 */
export const palette = {
  // Dark system (primary)
  background: '#080811',
  surface: '#141329',
  surfaceElevated: '#1A1830',
  primary: '#8757FF',
  primaryStrong: '#6B3FE0',
  violet: '#B69AFF',
  accent: '#00D9FF',
  success: '#36D98A',
  warning: '#FFB547',
  error: '#FF4D69',

  // Neutrals
  white: '#FFFFFF',
  textPrimary: '#F4F2FF',
  textSecondary: '#9B97B8',
  textFaint: '#6B6788',
  border: 'rgba(135, 87, 255, 0.18)',
  borderSubtle: 'rgba(255, 255, 255, 0.08)',

  // Light (kept for toggle)
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
  background: palette.background,
  backgroundElevated: palette.surface,
  surface: palette.surface,
  surfaceAlt: palette.surfaceElevated,
  border: palette.border,
  borderFocus: palette.primary,
  text: palette.textPrimary,
  textMuted: palette.textSecondary,
  textFaint: palette.textFaint,
  accent: palette.primary,
  accentStrong: palette.primaryStrong,
  accentSoft: 'rgba(135, 87, 255, 0.16)',
  success: palette.success,
  successSoft: 'rgba(54, 217, 138, 0.14)',
  warning: palette.warning,
  warningSoft: 'rgba(255, 181, 71, 0.14)',
  danger: palette.error,
  dangerSoft: 'rgba(255, 77, 105, 0.14)',
  white: palette.white,
  // Extra tokens used by new UI
  cyan: palette.accent,
  violet: palette.violet,
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
  cyan: '#00A3CC',
  violet: '#7B5CFF',
} as const;

export type AppColors = { [K in keyof typeof darkColors]: string };

export const darkGlass = {
  blurMethod: 'dimezisBlurViewSdk31Plus' as const,
  blurReductionFactor: 5,
  intensity: 72,
  tint: 'dark' as const,
  fill: 'rgba(20, 19, 41, 0.72)',
  fillStrong: 'rgba(8, 8, 17, 0.88)',
  fillSoft: 'rgba(255, 255, 255, 0.04)',
  border: 'rgba(135, 87, 255, 0.22)',
  borderBright: 'rgba(255, 255, 255, 0.10)',
  highlight: 'rgba(182, 154, 255, 0.18)',
  shadow: '#000000',
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
  shadowOpacity: 0.45,
  shadowRadius: 20,
  shadowOffset: { width: 0, height: 10 },
  elevation: 14,
};

export const lightGlassShadow: ViewStyle = {
  shadowColor: lightGlass.shadow,
  shadowOpacity: 0.12,
  shadowRadius: 14,
  shadowOffset: { width: 0, height: 6 },
  elevation: 8,
};

export type AppShadow = ViewStyle;

// Backwards-compatible aliases
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
