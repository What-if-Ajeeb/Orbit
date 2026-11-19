import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const SESSION_KEY = 'orbit.session.token';

type WebStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function getWebStorage(): WebStorage | null {
  return (globalThis as { localStorage?: WebStorage }).localStorage ?? null;
}

export async function getStoredSessionToken(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      return getWebStorage()?.getItem(SESSION_KEY) ?? null;
    } catch {
      return null;
    }
  }

  try {
    return await SecureStore.getItemAsync(SESSION_KEY);
  } catch {
    return null;
  }
}

export async function setStoredSessionToken(token: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      getWebStorage()?.setItem(SESSION_KEY, token);
    } catch {
      // Web storage can be unavailable in private browsing; the session still
      // works for the current app run.
    }
    return;
  }

  await SecureStore.setItemAsync(SESSION_KEY, token);
}

export async function clearStoredSessionToken(): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      getWebStorage()?.removeItem(SESSION_KEY);
    } catch {
      // Ignore unavailable storage.
    }
    return;
  }

  await SecureStore.deleteItemAsync(SESSION_KEY);
}
