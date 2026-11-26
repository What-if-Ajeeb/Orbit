import { useEffect, useMemo, useState } from 'react';
import { Keyboard, useWindowDimensions } from 'react-native';

import { resolveResponsiveLayout, type ResponsiveLayout } from '@/lib/responsive';

export type ResponsiveLayoutState = ResponsiveLayout & {
  /** Live window dimensions, including keyboard-driven height changes. */
  width: number;
  height: number;
  /** Dimensions used for layout decisions, held steady while the keyboard is open. */
  layoutWidth: number;
  layoutHeight: number;
  keyboardVisible: boolean;
};

type DimensionsSnapshot = {
  width: number;
  height: number;
};

/**
 * Breakpoints come from window dimensions. Keyboard visibility is tracked so a
 * soft keyboard cannot shrink the window enough to reclassify a tablet as a phone.
 */
export function useResponsiveLayout(): ResponsiveLayoutState {
  const windowDimensions = useWindowDimensions();
  const [keyboardBaseline, setKeyboardBaseline] = useState<DimensionsSnapshot | null>(null);

  useEffect(() => {
    const captureBaseline = () => {
      setKeyboardBaseline((current) => {
        return current ?? {
          width: windowDimensions.width,
          height: windowDimensions.height,
        };
      });
    };

    const releaseBaseline = () => setKeyboardBaseline(null);

    const subscriptions = [
      Keyboard.addListener('keyboardWillShow', captureBaseline),
      Keyboard.addListener('keyboardDidShow', captureBaseline),
      Keyboard.addListener('keyboardWillHide', releaseBaseline),
      Keyboard.addListener('keyboardDidHide', releaseBaseline),
    ];

    return () => {
      for (const subscription of subscriptions) {
        subscription.remove();
      }
    };
  }, [windowDimensions.height, windowDimensions.width]);

  const keyboardVisible = keyboardBaseline !== null;
  const layoutWidth = keyboardBaseline ? keyboardBaseline.width : windowDimensions.width;
  const layoutHeight = keyboardBaseline ? keyboardBaseline.height : windowDimensions.height;

  const layout = useMemo(
    () => resolveResponsiveLayout(layoutWidth, layoutHeight),
    [layoutHeight, layoutWidth]
  );

  return {
    ...layout,
    width: windowDimensions.width,
    height: windowDimensions.height,
    layoutWidth,
    layoutHeight,
    keyboardVisible,
  };
}
