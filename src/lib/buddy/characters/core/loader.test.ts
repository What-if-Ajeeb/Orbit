import { describe, expect, it } from 'vitest';

import { createSvgLoader } from './loader';

const baseXml = '<svg xmlns="http://www.w3.org/2000/svg"><g id="body-group"/></svg>';
const stageXml = '<svg xmlns="http://www.w3.org/2000/svg"><g id="body-group"><path id="stage"/></g></svg>';

function makeLoader() {
  return createSvgLoader({
    sources: { base: 1, stage: 2 },
    baseKey: 'base',
    resolveKey: (formId) => (formId === 'stage' ? 'stage' : 'base'),
    label: 'Test',
  });
}

describe('shared svg loader', () => {
  it('caches XML per key and deduplicates in-flight reads', async () => {
    const loader = makeLoader();
    const calls: number[] = [];
    loader.setReader(async (moduleId) => {
      calls.push(moduleId);
      return moduleId === 2 ? stageXml : baseXml;
    });

    const [a, b] = await Promise.all([loader.loadSvg('stage'), loader.loadSvg('stage')]);
    const c = await loader.loadSvg('stage');
    expect(a).toBe(stageXml);
    expect(b).toBe(stageXml);
    expect(c).toBe(stageXml);
    expect(calls).toEqual([2]);
  });

  it('resolves every known form key to its own asset', async () => {
    const loader = makeLoader();
    loader.setReader(async (moduleId) => (moduleId === 2 ? stageXml : baseXml));
    const result = await loader.loadFormSvg('stage');
    expect(result).toEqual({ key: 'stage', xml: stageXml, fallback: false });
  });

  it('falls back to base when a form key is absent and reports the fallback', async () => {
    const loader = createSvgLoader({
      sources: { base: 1 },
      baseKey: 'base',
      resolveKey: (formId) => formId ?? 'base',
      label: 'Test',
    });
    loader.setReader(async () => baseXml);
    const result = await loader.loadFormSvg('missing');
    expect(result).toEqual({ key: 'base', xml: baseXml, fallback: true });
  });

  it('falls back to base when a form asset read fails', async () => {
    const loader = makeLoader();
    let calls = 0;
    loader.setReader(async () => {
      calls += 1;
      if (calls === 1) throw new Error('missing file');
      return baseXml;
    });
    const result = await loader.loadFormSvg('stage');
    expect(result.fallback).toBe(true);
    expect(result.key).toBe('base');
  });

  it('rejects when a form asset is invalid and base is also invalid', async () => {
    const loader = makeLoader();
    loader.setReader(async () => 'not svg');
    await expect(loader.loadFormSvg('stage')).rejects.toThrow(/invalid SVG|missing SVG/);
  });

  it('rejects unknown keys instead of silently rendering a blank character', async () => {
    const loader = makeLoader();
    loader.setReader(async () => baseXml);
    await expect(loader.loadSvg('unknown')).rejects.toThrow(/missing SVG source/);
  });

  it('preload failures stay non-fatal', async () => {
    const loader = makeLoader();
    loader.setReader(async () => {
      throw new Error('offline');
    });
    await expect(loader.preload(['base', 'stage'])).resolves.toBeUndefined();
  });
});
