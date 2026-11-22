import { beforeEach, describe, expect, it } from 'vitest';

import { clearKikoSvgCache, loadKikoFormSvg, loadKikoSvgXml, setKikoAssetReader } from './svgLoader';

const baseXml = '<svg xmlns="http://www.w3.org/2000/svg"><g id="body-group"><path id="body"/></g></svg>';

describe('kiko svgLoader', () => {
  beforeEach(() => {
    clearKikoSvgCache();
    setKikoAssetReader(async () => baseXml);
  });

  it('caches XML by key', async () => {
    let calls = 0;
    setKikoAssetReader(async () => { calls++; return baseXml; });
    await loadKikoSvgXml('fox_base');
    await loadKikoSvgXml('fox_base');
    expect(calls).toBe(1);
  });

  it('falls back to base when form asset read fails', async () => {
    let calls = 0;
    setKikoAssetReader(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return baseXml;
    });
    const res = await loadKikoFormSvg('fox_vulpixie');
    expect(res.fallback).toBe(true);
    expect(res.key).toBe('fox_base');
    expect(res.xml).toContain('<svg');
  });

  it('throws when base SVG is invalid', async () => {
    setKikoAssetReader(async () => 'not-svg');
    await expect(loadKikoFormSvg('fox_base')).rejects.toThrow();
  });
});
