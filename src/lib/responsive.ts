export type ResponsiveMode =
  | 'phone'
  | 'tablet-portrait'
  | 'tablet-landscape-compact'
  | 'tablet-landscape-expanded';

export type ResponsiveLayout = {
  mode: ResponsiveMode;
  orientation: 'portrait' | 'landscape';
  isTablet: boolean;
  isLandscapeTablet: boolean;
  /** A permanent left sidebar replaces the overlay drawer and bottom bar. */
  persistentSidebar: boolean;
  /** Phones and tablet portrait keep the existing compact bottom navigation. */
  showBottomNav: boolean;
  /** Only large landscape tablets can show the resizable context panel. */
  contextPanelAvailable: boolean;
  sidebarWidth: number;
};

/** A device is treated as a tablet when its shorter screen side is tablet-sized. */
export const TABLET_MIN_SHORT_SIDE = 600;
export const EXPANDED_TABLET_MIN_WIDTH = 1024;
export const COMPACT_TABLET_SIDEBAR_WIDTH = 224;
export const EXPANDED_TABLET_SIDEBAR_WIDTH = 280;

export function resolveResponsiveLayout(width: number, height: number): ResponsiveLayout {
  const safeWidth = Number.isFinite(width) && width > 0 ? width : 0;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 0;
  const isTablet = Math.min(safeWidth, safeHeight) >= TABLET_MIN_SHORT_SIDE;
  const orientation: 'portrait' | 'landscape' =
    safeWidth >= safeHeight ? 'landscape' : 'portrait';

  let mode: ResponsiveMode = 'phone';

  if (isTablet) {
    if (orientation === 'portrait') {
      mode = 'tablet-portrait';
    } else {
      mode =
        safeWidth >= EXPANDED_TABLET_MIN_WIDTH
          ? 'tablet-landscape-expanded'
          : 'tablet-landscape-compact';
    }
  }

  const persistentSidebar =
    mode === 'tablet-landscape-compact' || mode === 'tablet-landscape-expanded';
  const sidebarWidth =
    mode === 'tablet-landscape-expanded'
      ? Math.min(320, Math.max(EXPANDED_TABLET_SIDEBAR_WIDTH, Math.round(safeWidth * 0.24)))
      : COMPACT_TABLET_SIDEBAR_WIDTH;

  return {
    mode,
    orientation,
    isTablet,
    isLandscapeTablet: persistentSidebar,
    persistentSidebar,
    showBottomNav: !persistentSidebar,
    contextPanelAvailable: mode === 'tablet-landscape-expanded',
    sidebarWidth,
  };
}
