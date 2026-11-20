export const colors = {
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
  danger: '#FF6B7A',
  dangerSoft: 'rgba(255, 107, 122, 0.12)',
  white: '#FFFFFF',
} as const;

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

/**
 * Shared glassmorphism tokens. Blur is applied only to large surfaces; small
 * rows and chips use the translucent fills to keep scrolling smooth.
 */
export const glass = {
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
} as const;

export const glassShadow = {
  shadowColor: glass.shadow,
  shadowOpacity: 0.4,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 12,
} as const;
