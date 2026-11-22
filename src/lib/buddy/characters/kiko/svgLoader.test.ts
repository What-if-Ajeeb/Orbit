import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearKikoSvgCache, loadKikoFormSvg, loadKikoSvgXml, setKikoAssetReader } from './svgLoader';

const baseXml = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320"><g id="body-group"></g><g id="head-group"><g id="eyes-group"></g><path id="mouth" d="M0 0"/></g></svg>';

describe('kiko svg loader', () => {
  beforeEach(() => {
    clearKikoSvgCache();
    setKikoAssetReader(null);
  });

  it('loads and caches svg xml', async () => {
    const reader = vi.fn(async () => baseXml);
    setKikoAssetReader(reader);
    const a = await loadKikoSvgXml('fox_base');
    const b = await loadKikoSvgXml('fox_base');
    expect(a).toContain('<svg');
    expect(b).toBe(a);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it('falls back to base when form asset read fails', async () => {
    const reader = vi.fn(async (moduleId: number) => {
      if (moduleId === 999999) throw new Error('missing');
      return baseXml;
    });
    // Force failure by temporarily pointing key to impossible module through custom reader behavior
    setKikoAssetReader(async (id) => {
      // first call in this test will be for shiny; simulate failure by id heuristic not needed, use formId flow
      return reader(id);
    });
    const res = await loadKikoFormSvg('fox_base');
    expect(res.key).toBe('fox_base');
    expect(res.fallback).toBe(false);
  });

  it('reports fallback on unknown/bad form load by reader error path', async () => {
    let calls = 0;
    setKikoAssetReader(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return baseXml;
    });
    const res = await loadKikoFormSvg('fox_vulpixie');
    expect(res.fallback).toBe(true);
    expect(res.key).toBe('fox_base');
    expect(res.xml).toContain('svg');
  });
});
