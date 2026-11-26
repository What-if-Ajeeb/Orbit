import { describe, expect, it } from 'vitest';

import {
  COMPACT_TABLET_SIDEBAR_WIDTH,
  EXPANDED_TABLET_MIN_WIDTH,
  EXPANDED_TABLET_SIDEBAR_WIDTH,
  resolveResponsiveLayout,
} from './responsive';

describe('resolveResponsiveLayout', () => {
  it('keeps phone portrait on the existing bottom navigation layout', () => {
    const layout = resolveResponsiveLayout(390, 844);

    expect(layout.mode).toBe('phone');
    expect(layout.isTablet).toBe(false);
    expect(layout.persistentSidebar).toBe(false);
    expect(layout.showBottomNav).toBe(true);
    expect(layout.contextPanelAvailable).toBe(false);
  });

  it('keeps a wide phone in landscape on the phone layout', () => {
    const layout = resolveResponsiveLayout(844, 390);

    expect(layout.mode).toBe('phone');
    expect(layout.orientation).toBe('landscape');
    expect(layout.showBottomNav).toBe(true);
  });

  it('uses a single main area with the drawer for tablet portrait', () => {
    const layout = resolveResponsiveLayout(768, 1024);

    expect(layout.mode).toBe('tablet-portrait');
    expect(layout.orientation).toBe('portrait');
    expect(layout.isTablet).toBe(true);
    expect(layout.persistentSidebar).toBe(false);
    expect(layout.showBottomNav).toBe(true);
    expect(layout.contextPanelAvailable).toBe(false);
  });

  it('uses a compact persistent sidebar on smaller landscape tablets', () => {
    const layout = resolveResponsiveLayout(
      EXPANDED_TABLET_MIN_WIDTH - 1,
      EXPANDED_TABLET_MIN_WIDTH - 200
    );

    expect(layout.mode).toBe('tablet-landscape-compact');
    expect(layout.persistentSidebar).toBe(true);
    expect(layout.showBottomNav).toBe(false);
    expect(layout.contextPanelAvailable).toBe(false);
    expect(layout.sidebarWidth).toBe(COMPACT_TABLET_SIDEBAR_WIDTH);
  });

  it('uses the full sidebar and context panel on large landscape tablets', () => {
    const layout = resolveResponsiveLayout(1366, 1024);

    expect(layout.mode).toBe('tablet-landscape-expanded');
    expect(layout.persistentSidebar).toBe(true);
    expect(layout.showBottomNav).toBe(false);
    expect(layout.contextPanelAvailable).toBe(true);
    expect(layout.sidebarWidth).toBeGreaterThanOrEqual(EXPANDED_TABLET_SIDEBAR_WIDTH);
  });

  it('treats the tablet threshold by shorter side, not by width alone', () => {
    expect(resolveResponsiveLayout(1024, 500).isTablet).toBe(false);
    expect(resolveResponsiveLayout(600, 900).isTablet).toBe(true);
  });
});
