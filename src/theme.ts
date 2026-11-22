import { Platform, type ViewStyle } from 'react-native';

/**
 * ORBIT Design System — flat, warm and calm.
 *
 * - Warm neutral surfaces (no glass, no blur, no glow)
 * - One coral accent for brand moments (send button, selection, marks)
 * - Inverse "pill" primary buttons (light on dark, dark on light)
 * - Serif headings, system sans for everything else
 */
export const palette = {
  // Dark
  background: '#121212',
  surface: '#1E1E1D',
  surfaceAlt: '#262624',
  textPrimary: '#ECECEA',
  textSecondary: '#A19F9A',
  textFaint: '#8E8C87',
  coral: '#D97757',
  coralStrong: '#C6613F',
  blue: '#5B9BFF',
  success: '#5FCB8F',
  warning: '#E8B04A',
  danger: '#F0707F',
  white: '#FFFFFF',

  // Light
  ivory: '#FAF9F5',
  paper: '#FFFFFF',
  sand: '#F0EEE6',
  ink: '#141413',
  inkMuted: '#5E5D59',
  inkFaint: '#6B6A65',
  coralOnLight: '#B5502F',
  blueOnLight: '#2563EB',
  successOnLight: '#177A4C',
  warningOnLight: '#9A6200',
  dangerOnLight: '#B83243',
} as const;

/** Serif for headings and greetings; the system font everywhere else. */
export const fonts = {
  serif: Platform.select({ ios: 'Georgia', default: 'serif' }) as string,
  mono: Platform.select({ ios: 'Menlo', default: 'monospace' }) as string,
} as const;

export const darkColors = {
  background: palette.background,
  backgroundElevated: palette.surface,
  surface: palette.surface,
  surfaceAlt: palette.surfaceAlt,
  border: 'rgba(255, 255, 255, 0.09)',
  borderFocus: palette.blue,
  text: palette.textPrimary,
  textMuted: palette.textSecondary,
  textFaint: palette.textFaint,
  accent: palette.coral,
  accentStrong: palette.coralStrong,
  accentSoft: 'rgba(217, 119, 87, 0.16)',
  success: palette.success,
  successSoft: 'rgba(95, 203, 143, 0.14)',
  warning: palette.warning,
  warningSoft: 'rgba(232, 176, 74, 0.14)',
  danger: palette.danger,
  dangerSoft: 'rgba(240, 112, 127, 0.14)',
  white: palette.white,
  /** Selection / toggles / links */
  blue: palette.blue,
  /** Inverse pill buttons: light on dark. */
  inverse: palette.textPrimary,
  onInverse: palette.background,
  // Legacy tokens still referenced by a few screens
  cyan: palette.blue,
  violet: palette.coral,
} as const;

export const lightColors = {
  background: palette.ivory,
  backgroundElevated: palette.paper,
  surface: palette.paper,
  surfaceAlt: palette.sand,
  border: 'rgba(20, 20, 19, 0.10)',
  borderFocus: palette.blueOnLight,
  text: palette.ink,
  textMuted: palette.inkMuted,
  textFaint: palette.inkFaint,
  accent: palette.coralOnLight,
  accentStrong: palette.coralOnLight,
  accentSoft: 'rgba(181, 80, 47, 0.10)',
  success: palette.successOnLight,
  successSoft: 'rgba(23, 122, 76, 0.12)',
  warning: palette.warningOnLight,
  warningSoft: 'rgba(154, 98, 0, 0.12)',
  danger: palette.dangerOnLight,
  dangerSoft: 'rgba(184, 50, 67, 0.10)',
  white: '#FFFFFF',
  blue: palette.blueOnLight,
  /** Inverse pill buttons: dark on light. */
  inverse: palette.ink,
  onInverse: palette.ivory,
  cyan: palette.blueOnLight,
  violet: palette.coralOnLight,
} as const;

export type AppColors = { [K in keyof typeof darkColors]: string };

/**
 * "Glass" tokens are kept under their old names so existing screens keep
 * working, but every value is now a flat, opaque surface. There is no blur.
 */
export const darkGlass = {
  blurMethod: 'dimezisBlurViewSdk31Plus' as const,
  blurReductionFactor: 5,
  intensity: 0,
  tint: 'dark' as const,
  fill: palette.surface,
  fillStrong: palette.surface,
  fillSoft: palette.surfaceAlt,
  border: 'rgba(255, 255, 255, 0.09)',
  borderBright: 'rgba(255, 255, 255, 0.09)',
  highlight: 'transparent',
  shadow: '#000000',
};

export const lightGlass = {
  ...darkGlass,
  tint: 'light' as const,
  fill: palette.paper,
  fillStrong: palette.paper,
  fillSoft: palette.sand,
  border: 'rgba(20, 20, 19, 0.10)',
  borderBright: 'rgba(20, 20, 19, 0.10)',
  highlight: 'transparent',
  shadow: palette.ink,
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

/** Flat design: no drop shadows. */
export const darkGlassShadow: ViewStyle = {};
export const lightGlassShadow: ViewStyle = {};

export type AppShadow = ViewStyle;

// Backwards-compatible aliases
export const colors = darkColors;
export const glass = darkGlass;
export const glassShadow = darkGlassShadow;

export const radius = {
  sm: 12,
  md: 16,
  lg: 22,
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
