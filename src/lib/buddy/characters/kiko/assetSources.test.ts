import { describe, expect, it } from 'vitest';

import { getKikoFormAssetKey } from './assetSources';

describe('kiko asset source mapping', () => {
  it('maps base and evolution forms', () => {
    expect(getKikoFormAssetKey('fox_base')).toBe('fox_base');
    expect(getKikoFormAssetKey('fox_vulpixie')).toBe('fox_vulpixie');
    expect(getKikoFormAssetKey('fox_aether')).toBe('fox_aether');
    expect(getKikoFormAssetKey('fox_flareonix')).toBe('fox_flareonix');
    expect(getKikoFormAssetKey('fox_stormlynx')).toBe('fox_stormlynx');
    expect(getKikoFormAssetKey('fox_sylvia')).toBe('fox_sylvia');
    expect(getKikoFormAssetKey('fox_eclipseon')).toBe('fox_eclipseon');
  });

  it('maps shiny and mythical variants', () => {
    expect(getKikoFormAssetKey('fox_base_shiny')).toBe('fox_base_shiny');
    expect(getKikoFormAssetKey('something_shiny')).toBe('fox_base_shiny');
    expect(getKikoFormAssetKey('something_mythical')).toBe('fox_mythical');
  });

  it('falls back to base for unknown', () => {
    expect(getKikoFormAssetKey(undefined)).toBe('fox_base');
    expect(getKikoFormAssetKey('unknown')).toBe('fox_base');
  });
});
