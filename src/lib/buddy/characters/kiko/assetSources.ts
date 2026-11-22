import baseSvg from '../../../../../orbit-buddy/characters/kiko/base.svg';
import expressionsSvg from '../../../../../orbit-buddy/characters/kiko/expressions.svg';
import animationsSvg from '../../../../../orbit-buddy/characters/kiko/animations.svg';
import vulpixieSvg from '../../../../../orbit-buddy/characters/kiko/evolution-vulpixie.svg';
import aetherSvg from '../../../../../orbit-buddy/characters/kiko/evolution-aether.svg';
import flareonixSvg from '../../../../../orbit-buddy/characters/kiko/evolution-flareonix.svg';
import stormlynxSvg from '../../../../../orbit-buddy/characters/kiko/evolution-stormlynx.svg';
import sylviaSvg from '../../../../../orbit-buddy/characters/kiko/evolution-sylvia.svg';
import eclipseonSvg from '../../../../../orbit-buddy/characters/kiko/evolution-eclipseon.svg';
import shinySvg from '../../../../../orbit-buddy/characters/kiko/shiny-form.svg';
import mythicalSvg from '../../../../../orbit-buddy/characters/kiko/mythical-form.svg';

export type KikoAssetKey =
  | 'base' | 'expressions' | 'animations'
  | 'fox_base' | 'fox_vulpixie' | 'fox_aether' | 'fox_flareonix' | 'fox_stormlynx'
  | 'fox_sylvia' | 'fox_eclipseon' | 'fox_base_shiny' | 'fox_mythical';

export const KIKO_SVG_SOURCES: Record<KikoAssetKey, number> = {
  base: baseSvg as unknown as number,
  expressions: expressionsSvg as unknown as number,
  animations: animationsSvg as unknown as number,
  fox_base: baseSvg as unknown as number,
  fox_vulpixie: vulpixieSvg as unknown as number,
  fox_aether: aetherSvg as unknown as number,
  fox_flareonix: flareonixSvg as unknown as number,
  fox_stormlynx: stormlynxSvg as unknown as number,
  fox_sylvia: sylviaSvg as unknown as number,
  fox_eclipseon: eclipseonSvg as unknown as number,
  fox_base_shiny: shinySvg as unknown as number,
  fox_mythical: mythicalSvg as unknown as number,
};

export function getKikoFormAssetKey(formId?: string): KikoAssetKey {
  if (!formId) return 'fox_base';
  if (formId in KIKO_SVG_SOURCES) return formId as KikoAssetKey;
  if (formId.includes('sylvia') || formId.includes('eclipseon')) return formId as KikoAssetKey;
  if (formId.includes('shiny')) return 'fox_base_shiny';
  if (formId.includes('mythical')) return 'fox_mythical';
  return 'fox_base';
}
