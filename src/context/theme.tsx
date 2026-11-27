import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import { Platform, useColorScheme } from 'react-native';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type PropsWithChildren,
} from 'react';

import {
  darkColors,
  darkGlass,
  darkGlassShadow,
  lightColors,
  lightGlass,
  lightGlassShadow,
  type AppColors,
  type AppGlass,
  type AppShadow,
} from '@/theme';

/** 'system' follows the phone's light/dark setting. */
export type ThemeMode = 'system' | 'dark' | 'light';

type ThemeContextValue = {
  /** The saved preference (may be 'system'). */
  mode: ThemeMode;
  /** What is actually on screen right now. */
  resolvedMode: 'dark' | 'light';
  isLight: boolean;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  colors: AppColors;
  glass: AppGlass;
  glassShadow: AppShadow;
};

const THEME_KEY = 'orbit.theme.v1';
const ThemeContext = createContext<ThemeContextValue | null>(null);

type WebStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function getWebStorage(): WebStorage | null {
  return (globalThis as { localStorage?: WebStorage }).localStorage ?? null;
}

function isThemeMode(value: string | null): value is ThemeMode {
  return value === 'system' || value === 'dark' || value === 'light';
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const raw =
          Platform.OS === 'web'
            ? getWebStorage()?.getItem(THEME_KEY) ?? null
            : await SecureStore.getItemAsync(THEME_KEY);

        if (active && isThemeMode(raw)) {
          setModeState(raw);
        }
      } catch (error) {
        console.warn('Could not load the theme.', error);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);

    void (async () => {
      try {
        if (Platform.OS === 'web') {
          getWebStorage()?.setItem(THEME_KEY, next);
        } else {
          await SecureStore.setItemAsync(THEME_KEY, next);
        }
      } catch (error) {
        console.warn('Could not save the theme.', error);
      }
    })();
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const resolvedMode: 'dark' | 'light' =
      mode === 'system' ? (systemScheme === 'light' ? 'light' : 'dark') : mode;
    const isLight = resolvedMode === 'light';

    return {
      mode,
      resolvedMode,
      isLight,
      setMode,
      toggleMode: () => setMode(isLight ? 'dark' : 'light'),
      colors: isLight ? lightColors : darkColors,
      glass: isLight ? lightGlass : darkGlass,
      glassShadow: isLight ? lightGlassShadow : darkGlassShadow,
    };
  }, [mode, setMode, systemScheme]);

  // Keep the native root view in sync with the resolved theme so launch,
  // navigation transitions and keyboard resizes never flash the wrong color.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(value.colors.background).catch((error: unknown) => {
      console.warn('Could not update the system background.', error);
    });
  }, [value.colors.background]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);

  if (!context) {
    throw new Error('useAppTheme must be used inside ThemeProvider.');
  }

  return context;
}

export type AppTheme = ThemeContextValue;

/** Builds StyleSheet styles from the active palette. */
export function useStyles<T>(factory: (theme: AppTheme) => T): T {
  const theme = useAppTheme();

  return useMemo(() => factory(theme), [theme, factory]);
}
