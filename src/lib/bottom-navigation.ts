import type { Href } from 'expo-router';

import type { PluginNavigationContribution } from '@/lib/plugins/platform';

export const BOTTOM_NAV_SLOT_COUNT = 3;

/**
 * Stable IDs. Display labels are never persisted, so renaming a screen does not
 * invalidate a user's configuration.
 */
export const BOTTOM_NAV_DEFAULT_IDS = ['chat', 'tasks', 'make'] as const;

export type BottomNavDestination = {
  id: string;
  label: string;
  icon: string;
  href: Href;
  description: string;
  source: 'builtin' | 'plugin';
};

export type BottomNavSlot = {
  index: number;
  /** The persisted ID, which may point to a plugin that is no longer available. */
  requestedId: string | null;
  destination: BottomNavDestination;
  available: boolean;
};

/**
 * Built-in destinations mirror the screens registered in the app layout. Plugin
 * destinations are added separately from the live registry snapshot, never from
 * a duplicated static list.
 */
export const BUILT_IN_NAV_DESTINATIONS: BottomNavDestination[] = [
  {
    id: 'chat',
    label: 'Chat',
    icon: 'chatbubbles-outline',
    href: '/chat',
    description: 'Agent conversations',
    source: 'builtin',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    icon: 'checkbox-outline',
    href: '/tasks',
    description: 'Your task list',
    source: 'builtin',
  },
  {
    id: 'make',
    label: 'Make',
    icon: 'flash-outline',
    href: '/workflows',
    description: 'Agent workflows',
    source: 'builtin',
  },
  {
    id: 'today',
    label: 'Today',
    icon: 'planet-outline',
    href: '/',
    description: 'Home and overview',
    source: 'builtin',
  },
  {
    id: 'buddy',
    label: 'Buddy',
    icon: 'paw-outline',
    href: '/buddy',
    description: 'Your companion',
    source: 'builtin',
  },
  {
    id: 'projects',
    label: 'Projects',
    icon: 'briefcase-outline',
    href: '/projects',
    description: 'Workspace overview',
    source: 'builtin',
  },
  {
    id: 'plugins',
    label: 'Plugins',
    icon: 'extension-puzzle-outline',
    href: '/plugins',
    description: 'Installed plugins',
    source: 'builtin',
  },
  {
    id: 'marketplace',
    label: 'Marketplace',
    icon: 'storefront-outline',
    href: '/marketplace',
    description: 'Discover plugins',
    source: 'builtin',
  },
  {
    id: 'agents',
    label: 'AI Agents',
    icon: 'people-outline',
    href: '/agents',
    description: 'Individual agents',
    source: 'builtin',
  },
  {
    id: 'conversations',
    label: 'Conversations',
    icon: 'chatbubble-outline',
    href: '/conversations',
    description: 'Full chat history',
    source: 'builtin',
  },
  {
    id: 'connections',
    label: 'Connections',
    icon: 'cloud-outline',
    href: '/connections',
    description: 'Connected tools',
    source: 'builtin',
  },
  {
    id: 'artifacts',
    label: 'Artifacts',
    icon: 'cube-outline',
    href: '/artifacts',
    description: 'Saved outputs',
    source: 'builtin',
  },
  {
    id: 'settings',
    label: 'Settings',
    icon: 'settings-outline',
    href: '/settings',
    description: 'App settings',
    source: 'builtin',
  },
];

/** Plugin nav entry IDs are only unique inside a plugin, so the slug is included. */
export function pluginDestinationId(pluginId: string, entryId: string): string {
  return `plugin:${pluginId}:${entryId}`;
}

export function buildNavDestinations(
  pluginNavigation: readonly PluginNavigationContribution[] = []
): BottomNavDestination[] {
  const pluginDestinations = pluginNavigation.map((entry) => ({
    id: pluginDestinationId(entry.pluginId, entry.id),
    label: entry.label,
    icon: entry.icon,
    href: `/plugin/${encodeURIComponent(entry.pluginId)}?screen=${encodeURIComponent(
      entry.routeId
    )}` as Href,
    description: `${entry.pluginName} plugin`,
    source: 'plugin' as const,
  }));

  return [...BUILT_IN_NAV_DESTINATIONS, ...pluginDestinations];
}

/**
 * Returns exactly three slots. An unavailable or duplicated saved ID falls back
 * to the default for that slot, then to any unused destination. The original
 * requested ID is preserved so Settings can ask the user to choose a replacement.
 */
export function resolveNavSlots(
  savedIds: readonly string[],
  destinations: readonly BottomNavDestination[]
): BottomNavSlot[] {
  const byId = new Map(destinations.map((destination) => [destination.id, destination]));
  const used = new Set<string>();

  const fallbackFor = (index: number): BottomNavDestination => {
    const preferred = [BOTTOM_NAV_DEFAULT_IDS[index], ...BOTTOM_NAV_DEFAULT_IDS];

    for (const id of preferred) {
      const destination = id ? byId.get(id) : undefined;

      if (destination && !used.has(destination.id)) {
        return destination;
      }
    }

    const unused = destinations.find((destination) => !used.has(destination.id));
    return unused ?? BUILT_IN_NAV_DESTINATIONS[0];
  };

  return Array.from({ length: BOTTOM_NAV_SLOT_COUNT }, (_, index) => {
    const requestedId = savedIds[index] ?? BOTTOM_NAV_DEFAULT_IDS[index] ?? null;
    const requested = requestedId ? byId.get(requestedId) : undefined;
    const available = Boolean(requested) && !used.has(requestedId ?? '');
    const destination = available && requested ? requested : fallbackFor(index);

    used.add(destination.id);

    return { index, requestedId, destination, available };
  });
}

/** Normalizes a draft to exactly three unique, currently available IDs. */
export function normalizeNavIds(
  ids: readonly string[],
  destinations: readonly BottomNavDestination[]
): string[] {
  return resolveNavSlots(ids, destinations).map((slot) => slot.destination.id);
}

export function unavailableNavIds(
  savedIds: readonly string[],
  destinations: readonly BottomNavDestination[]
): string[] {
  const available = new Set(destinations.map((destination) => destination.id));
  return savedIds.filter((id) => !available.has(id));
}

/** Compares a destination href with the current pathname without query params. */
export function isNavPathActive(pathname: string, href: Href): boolean {
  const target = String(href).split('?')[0];
  const current = pathname.split('?')[0];

  if (target === '/') {
    return current === '/' || current === '/index';
  }

  return current === target || current.startsWith(`${target}/`);
}
