import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
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

export type ThemeMode = 'dark' | 'light';

type ThemeContextValue = {
  mode: ThemeMode;
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
  return value === 'dark' || value === 'light';
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [mode, setModeState] = useState<ThemeMode>('dark');

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
    const isLight = mode === 'light';

    return {
      mode,
      isLight,
      setMode,
      toggleMode: () => setMode(isLight ? 'dark' : 'light'),
      colors: isLight ? lightColors : darkColors,
      glass: isLight ? lightGlass : darkGlass,
      glassShadow: isLight ? lightGlassShadow : darkGlassShadow,
    };
  }, [mode, setMode]);

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
