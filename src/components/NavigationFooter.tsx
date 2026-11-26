import { useNavigationFooter } from '@/context/navigation-footer';

import { BottomNavigation } from './BottomNavigation';

/** Shared host for the single floating footer used across the authenticated app. */
export function NavigationFooter() {
  const { visible } = useNavigationFooter();

  return visible ? <BottomNavigation /> : null;
}
