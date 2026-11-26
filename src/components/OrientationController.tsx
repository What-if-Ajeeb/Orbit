import * as ScreenOrientation from 'expo-screen-orientation';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { useResponsiveLayout } from '@/hooks/useResponsiveLayout';

/**
 * Tablets may rotate freely. Phones keep the original portrait behavior even
 * though app.json no longer applies a global orientation lock.
 */
export function OrientationController() {
  const { isTablet } = useResponsiveLayout();

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        if (cancelled) {
          return;
        }

        if (isTablet) {
          await ScreenOrientation.unlockAsync();
        } else {
          await ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
        }
      } catch (error) {
        console.warn('Could not apply the device orientation policy.', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isTablet]);

  return null;
}
