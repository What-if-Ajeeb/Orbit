import { getKikoFormAssetKey, KIKO_SVG_SOURCES, type KikoAssetKey } from './assetSources';

const xmlCache = new Map<KikoAssetKey, string>();
const promiseCache = new Map<KikoAssetKey, Promise<string>>();
const parsedCache = new Map<string, unknown>();

export type AssetReader = (moduleId: number) => Promise<string>;

const defaultReader: AssetReader = async (moduleId: number) => {
  // Lazy import so node tests can inject a reader without loading RN deps.
  const { Asset } = await import('expo-asset');
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  const res = await fetch(uri);
  if (!res.ok) throw new Error(`Failed to read SVG asset: ${res.status}`);
  return await res.text();
};

let reader: AssetReader = defaultReader;

export function setKikoAssetReader(next: AssetReader | null) {
  reader = next ?? defaultReader;
}

export async function loadKikoSvgXml(key: KikoAssetKey): Promise<string> {
  const cached = xmlCache.get(key);
  if (cached) return cached;
  const pending = promiseCache.get(key);
  if (pending) return pending;

  const p = (async () => {
    const moduleId = KIKO_SVG_SOURCES[key] ?? KIKO_SVG_SOURCES.fox_base;
    const xml = await reader(moduleId);
    xmlCache.set(key, xml);
    return xml;
  })().finally(() => {
    promiseCache.delete(key);
  });

  promiseCache.set(key, p);
  return p;
}

export async function preloadKikoAssets(keys: KikoAssetKey[] = ['base', 'expressions', 'animations', 'fox_base']): Promise<void> {
  await Promise.all(keys.map((k) => loadKikoSvgXml(k).catch((e) => { console.warn('Kiko asset preload failed', k, e); return ''; })));
}

export async function loadKikoFormSvg(formId?: string): Promise<{ key: KikoAssetKey; xml: string; fallback: boolean }> {
  const key = getKikoFormAssetKey(formId);
  try {
    const xml = await loadKikoSvgXml(key);
    return { key, xml, fallback: false };
  } catch (e) {
    console.warn('Kiko form SVG load failed, falling back to base', formId, e);
    const xml = await loadKikoSvgXml('fox_base');
    return { key: 'fox_base', xml, fallback: true };
  }
}

export function getCachedParsed<T>(key: string): T | undefined {
  return parsedCache.get(key) as T | undefined;
}

export function setCachedParsed<T>(key: string, value: T) {
  parsedCache.set(key, value);
}

export function clearKikoSvgCache() {
  xmlCache.clear();
  promiseCache.clear();
  parsedCache.clear();
}
