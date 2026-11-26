import { createContext, useContext, useMemo, type PropsWithChildren } from 'react';
import { usePathname } from 'expo-router';

import { BOTTOM_NAV_RESERVE } from '@/components/BottomNavigation';
import { useTabletLayout } from '@/context/tablet-layout';
import { isBottomNavRoute } from '@/lib/bottom-navigation';

type NavigationFooterContextValue = {
  /** Whether the shared floating footer is currently mounted. */
  visible: boolean;
  /** Bottom padding applied once by the app layout to the active screen. */
  reserve: number;
};

const FALLBACK_VALUE: NavigationFooterContextValue = { visible: false, reserve: 0 };

const NavigationFooterContext = createContext<NavigationFooterContextValue>(FALLBACK_VALUE);

/**
 * Single source of truth for footer visibility. Route policy lives in
 * `src/lib/bottom-navigation.ts`; the shell decides whether a floating footer
 * makes sense for the current device and keyboard state.
 */
export function NavigationFooterProvider({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const { layout } = useTabletLayout();

  const visible =
    layout.showBottomNav && isBottomNavRoute(pathname) && !layout.keyboardVisible;

  const value = useMemo<NavigationFooterContextValue>(
    () => ({ visible, reserve: visible ? BOTTOM_NAV_RESERVE : 0 }),
    [visible]
  );

  return (
    <NavigationFooterContext.Provider value={value}>{children}</NavigationFooterContext.Provider>
  );
}

export function useNavigationFooter(): NavigationFooterContextValue {
  return useContext(NavigationFooterContext);
}
