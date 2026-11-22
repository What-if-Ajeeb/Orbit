import { getKikoFormAssetKey, KIKO_SVG_SOURCES, type KikoAssetKey } from './assetSources';

const xmlCache = new Map<KikoAssetKey, string>();
const promiseCache = new Map<KikoAssetKey, Promise<string>>();
const parsedCache = new Map<string, unknown>();

export type AssetReader = (moduleId: number) => Promise<string>;

async function readAssetXml(moduleId: number): Promise<string> {
  const { Asset } = await import('expo-asset');
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error('Kiko SVG asset URI unavailable');

  // Strategy 1: fetch (works for http(s) and many file/content URIs)
  try {
    const res = await fetch(uri);
    if (res.ok) {
      const text = await res.text();
      if (text.includes('<svg')) return text;
    }
  } catch (e) {
    if (__DEV__) console.warn('Kiko SVG fetch failed, trying FileSystem', uri, e);
  }

  // Strategy 2: expo-file-system (Android/iOS local files) - dynamic module name avoids bundler/lint static resolution issues
  try {
    const fsMod = 'expo-file-system';
    const FS: any = await import(fsMod);
    const read = FS.readAsStringAsync ?? FS.FileSystem?.readAsStringAsync;
    const encoding = FS.EncodingType?.UTF8 ?? 'utf8';
    if (typeof read === 'function') {
      const text = await read(uri, { encoding });
      if (typeof text === 'string' && text.includes('<svg')) return text;
    }
  } catch (e) {
    if (__DEV__) console.warn('Kiko SVG FileSystem read failed', uri, e);
  }
  try {
    const fsLegacyMod = 'expo-file-system/legacy';
    const FSLegacy: any = await import(fsLegacyMod);
    const read = FSLegacy.readAsStringAsync;
    if (typeof read === 'function') {
      const text = await read(uri, { encoding: FSLegacy.EncodingType?.UTF8 ?? 'utf8' });
      if (typeof text === 'string' && text.includes('<svg')) return text;
    }
  } catch (e) {
    if (__DEV__) console.warn('Kiko SVG legacy FileSystem read failed', uri, e);
  }

  // Strategy 3: fetch asset.uri if different
  if (asset.uri && asset.uri !== uri) {
    const res = await fetch(asset.uri);
    if (res.ok) {
      const text = await res.text();
      if (text.includes('<svg')) return text;
    }
  }

  throw new Error(`Failed to read Kiko SVG asset: ${uri}`);
}

const defaultReader: AssetReader = readAssetXml;

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
    if (!xml.includes('<svg')) throw new Error(`Invalid SVG content for ${key}`);
    xmlCache.set(key, xml);
    return xml;
  })().finally(() => {
    promiseCache.delete(key);
  });

  promiseCache.set(key, p);
  return p;
}

export async function preloadKikoAssets(keys: KikoAssetKey[] = ['fox_base']): Promise<void> {
  await Promise.all(keys.map((k) => loadKikoSvgXml(k).catch((e) => { console.warn('Kiko asset preload failed', k, e); return ''; })));
}

export async function loadKikoFormSvg(formId?: string): Promise<{ key: KikoAssetKey; xml: string; fallback: boolean }> {
  const key = getKikoFormAssetKey(formId);
  try {
    const xml = await loadKikoSvgXml(key);
    return { key, xml, fallback: false };
  } catch (e) {
    console.warn('Kiko form SVG load failed, falling back to base', { formId, key, error: e });
    if (key !== 'fox_base') {
      try {
        const xml = await loadKikoSvgXml('fox_base');
        return { key: 'fox_base', xml, fallback: true };
      } catch (baseErr) {
        console.error('Kiko base SVG also failed to load', baseErr);
        throw baseErr;
      }
    }
    throw e;
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
