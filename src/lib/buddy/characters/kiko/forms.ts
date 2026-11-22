export type KikoFormId =
  | 'fox_base'
  | 'fox_vulpixie'
  | 'fox_aether'
  | 'fox_flareonix'
  | 'fox_stormlynx'
  | 'fox_sylvia'
  | 'fox_eclipseon'
  | 'fox_base_shiny';

export type KikoPalette = {
  fur1: string; fur2: string; deep1: string; deep2: string; cream1: string; cream2: string;
  earInner: string; scarf: string; gem: string; accentMark?: string;
};

export const KIKO_PALETTES: Record<KikoFormId, KikoPalette> = {
  fox_base:       { fur1: '#FFB067', fur2: '#E06A2B', deep1: '#F28A42', deep2: '#BF4F1A', cream1: '#FFF4E7', cream2: '#F3D4B8', earInner: '#FFD0BE', scarf: '#4E8BFF', gem: '#FFD76A' },
  fox_vulpixie:   { fur1: '#FFBE7A', fur2: '#E8742F', deep1: '#F4974B', deep2: '#C75A1D', cream1: '#FFF7EF', cream2: '#F6DFC7', earInner: '#FFD0BE', scarf: '#5B8CFF', gem: '#FFD76A' },
  fox_aether:     { fur1: '#C4B5FD', fur2: '#7C3AED', deep1: '#A78BFA', deep2: '#5B21B6', cream1: '#F5F3FF', cream2: '#DDD6FE', earInner: '#DDD6FE', scarf: '#8B5CF6', gem: '#E9D5FF', accentMark: 'star' },
  fox_flareonix:  { fur1: '#FDBA74', fur2: '#EA580C', deep1: '#FB923C', deep2: '#C2410C', cream1: '#FFF7ED', cream2: '#FED7AA', earInner: '#FED7AA', scarf: '#DC2626', gem: '#FDE68A', accentMark: 'flame' },
  fox_stormlynx:  { fur1: '#FDE68A', fur2: '#EAB308', deep1: '#FACC15', deep2: '#A16207', cream1: '#FEFCE8', cream2: '#FEF08A', earInner: '#FEF08A', scarf: '#3B82F6', gem: '#FDE68A', accentMark: 'bolt' },
  fox_sylvia:     { fur1: '#E0F2FE', fur2: '#38BDF8', deep1: '#7DD3FC', deep2: '#0284C7', cream1: '#F8FAFC', cream2: '#E0F2FE', earInner: '#BAE6FD', scarf: '#7DD3FC', gem: '#E0F2FE', accentMark: 'star' },
  fox_eclipseon:  { fur1: '#94A3B8', fur2: '#1E293B', deep1: '#475569', deep2: '#0F172A', cream1: '#E2E8F0', cream2: '#CBD5E1', earInner: '#CBD5E1', scarf: '#334155', gem: '#CBD5E1', accentMark: 'moon' },
  fox_base_shiny: { fur1: '#F5D0FE', fur2: '#A855F7', deep1: '#D946EF', deep2: '#7E22CE', cream1: '#FAF5FF', cream2: '#E9D5FF', earInner: '#F5D0FE', scarf: '#06B6D4', gem: '#FDE68A' },
};

export function getKikoPalette(formId?: string): KikoPalette {
  if (formId && formId in KIKO_PALETTES) return KIKO_PALETTES[formId as KikoFormId];
  return KIKO_PALETTES.fox_base;
}
