import { createSvgLoader } from '../core/loader';
import type { AssetReader } from '../core/types';
import { getKikoFormAssetKey, KIKO_SVG_SOURCES, type KikoAssetKey } from './assetSources';

export type { AssetReader } from '../core/types';

const loader = createSvgLoader({
  sources: KIKO_SVG_SOURCES,
  baseKey: 'fox_base',
  resolveKey: (formId) => getKikoFormAssetKey(formId),
  label: 'Kiko',
});

export function setKikoAssetReader(next: AssetReader | null) {
  loader.setReader(next);
}

export async function loadKikoSvgXml(key: KikoAssetKey): Promise<string> {
  return loader.loadSvg(key);
}

export async function preloadKikoAssets(keys: KikoAssetKey[] = ['fox_base']): Promise<void> {
  await loader.preload(keys);
}

export async function loadKikoFormSvg(formId?: string): Promise<{ key: KikoAssetKey; xml: string; fallback: boolean }> {
  const result = await loader.loadFormSvg(formId);
  return { ...result, key: result.key as KikoAssetKey };
}

export function getCachedParsed<T>(key: string): T | undefined {
  return loader.getCachedParsed<T>(key);
}

export function setCachedParsed<T>(key: string, value: T) {
  loader.setCachedParsed(key, value);
}

export function clearKikoSvgCache() {
  loader.clear();
}
