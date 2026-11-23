import type { AssetReader, SvgSourceMap } from './types';

async function readAssetXml(moduleId: number): Promise<string> {
  const { Asset } = await import('expo-asset');
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri ?? asset.uri;
  if (!uri) throw new Error('SVG asset URI unavailable');

  // Strategy 1: fetch (works for http(s) and many file/content URIs)
  try {
    const res = await fetch(uri);
    if (res.ok) {
      const text = await res.text();
      if (text.includes('<svg')) return text;
    }
  } catch (e) {
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('SVG fetch failed, trying FileSystem', uri, e);
  }

  // Strategy 2: expo-file-system (Android/iOS local files)
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
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('SVG FileSystem read failed', uri, e);
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
    if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn('SVG legacy FileSystem read failed', uri, e);
  }

  if (asset.uri && asset.uri !== uri) {
    const res = await fetch(asset.uri);
    if (res.ok) {
      const text = await res.text();
      if (text.includes('<svg')) return text;
    }
  }

  throw new Error(`Failed to read SVG asset: ${uri}`);
}

export const defaultSvgAssetReader: AssetReader = readAssetXml;

export type SvgLoaderOptions = {
  sources: SvgSourceMap;
  baseKey: string;
  resolveKey?: (formId?: string) => string;
  label?: string;
};

export type LoadedSvg = { key: string; xml: string; fallback: boolean };

export function createSvgLoader({ sources, baseKey, resolveKey, label = 'Buddy' }: SvgLoaderOptions) {
  const xmlCache = new Map<string, string>();
  const promiseCache = new Map<string, Promise<string>>();
  const parsedCache = new Map<string, unknown>();
  let reader: AssetReader = defaultSvgAssetReader;

  function setReader(next: AssetReader | null) {
    reader = next ?? defaultSvgAssetReader;
  }

  async function loadSvg(key: string): Promise<string> {
    const cached = xmlCache.get(key);
    if (cached) return cached;
    const pending = promiseCache.get(key);
    if (pending) return pending;

    const promise = (async () => {
      const moduleId = sources[key];
      if (moduleId === undefined) throw new Error(`${label} missing SVG source for "${key}"`);
      const xml = await reader(moduleId);
      if (!xml.includes('<svg')) throw new Error(`${label} invalid SVG content for "${key}"`);
      xmlCache.set(key, xml);
      return xml;
    })().finally(() => promiseCache.delete(key));

    promiseCache.set(key, promise);
    return promise;
  }

  async function loadFormSvg(formId?: string): Promise<LoadedSvg> {
    const requested = resolveKey ? resolveKey(formId) : formId && formId in sources ? formId : baseKey;
    const key = requested in sources ? requested : baseKey;
    try {
      const xml = await loadSvg(key);
      return { key, xml, fallback: key !== requested };
    } catch (error) {
      if (key !== baseKey) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn(`${label} form SVG failed, using base`, { formId, key, error });
        const xml = await loadSvg(baseKey);
        return { key: baseKey, xml, fallback: true };
      }
      throw error;
    }
  }

  async function preload(keys: string[] = [baseKey]): Promise<void> {
    await Promise.all(
      keys.map((key) =>
        loadSvg(key).catch((error) => {
          if (typeof __DEV__ !== 'undefined' && __DEV__) console.warn(`${label} asset preload failed`, key, error);
          return '';
        })
      )
    );
  }

  function getCachedParsed<T>(key: string): T | undefined {
    return parsedCache.get(key) as T | undefined;
  }

  function setCachedParsed<T>(key: string, value: T) {
    parsedCache.set(key, value);
  }

  function clear() {
    xmlCache.clear();
    promiseCache.clear();
    parsedCache.clear();
  }

  return { loadSvg, loadFormSvg, preload, setReader, getCachedParsed, setCachedParsed, clear };
}
