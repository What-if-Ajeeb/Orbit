import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { BOTTOM_NAV_DEFAULT_IDS, BOTTOM_NAV_SLOT_COUNT } from '@/lib/bottom-navigation';

const NAVIGATION_KEY = 'orbit.bottom-navigation.v1';

type WebStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

function getWebStorage(): WebStorage | null {
  return (globalThis as { localStorage?: WebStorage }).localStorage ?? null;
}

/**
 * Only the stable IDs are stored. Availability is resolved against the current
 * built-in/plugin catalog on every load so a removed plugin cannot inject a URL.
 */
export function normalizeStoredNavIds(value: unknown): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  if (Array.isArray(value)) {
    for (const candidate of value) {
      if (
        typeof candidate === 'string' &&
        candidate.length > 0 &&
        candidate.length <= 160 &&
        !seen.has(candidate)
      ) {
        seen.add(candidate);
        ids.push(candidate);
      }
    }
  }

  for (const fallback of BOTTOM_NAV_DEFAULT_IDS) {
    if (ids.length >= BOTTOM_NAV_SLOT_COUNT) {
      break;
    }

    if (!seen.has(fallback)) {
      seen.add(fallback);
      ids.push(fallback);
    }
  }

  return ids.slice(0, BOTTOM_NAV_SLOT_COUNT);
}

export async function loadBottomNavIds(): Promise<string[]> {
  try {
    const raw =
      Platform.OS === 'web'
        ? getWebStorage()?.getItem(NAVIGATION_KEY) ?? null
        : await SecureStore.getItemAsync(NAVIGATION_KEY);

    return normalizeStoredNavIds(raw ? JSON.parse(raw) : null);
  } catch (error) {
    console.warn('Could not load bottom navigation.', error);
    return [...BOTTOM_NAV_DEFAULT_IDS];
  }
}

export async function saveBottomNavIds(ids: readonly string[]): Promise<string[]> {
  const normalized = normalizeStoredNavIds(ids);
  const raw = JSON.stringify(normalized);

  if (Platform.OS === 'web') {
    getWebStorage()?.setItem(NAVIGATION_KEY, raw);
    return normalized;
  }

  await SecureStore.setItemAsync(NAVIGATION_KEY, raw);
  return normalized;
}

export async function clearBottomNavIds(): Promise<void> {
  if (Platform.OS === 'web') {
    getWebStorage()?.removeItem(NAVIGATION_KEY);
    return;
  }

  await SecureStore.deleteItemAsync(NAVIGATION_KEY);
}
