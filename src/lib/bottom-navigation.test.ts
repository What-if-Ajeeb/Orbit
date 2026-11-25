import { describe, expect, it } from 'vitest';

import type { PluginNavigationContribution } from './plugins/platform';
import {
  BOTTOM_NAV_DEFAULT_IDS,
  BOTTOM_NAV_SLOT_COUNT,
  buildNavDestinations,
  isNavPathActive,
  normalizeNavIds,
  pluginDestinationId,
  resolveNavSlots,
  unavailableNavIds,
} from './bottom-navigation';

const pluginEntry = {
  pluginId: 'com.example.hello-orbit',
  pluginName: 'Hello Orbit',
  trustLevel: 'local',
  id: 'hello-nav',
  label: 'Hello',
  icon: 'sparkles-outline',
  routeId: 'home',
  order: 50,
  path: '/plugin/com.example.hello-orbit?screen=home',
} as unknown as PluginNavigationContribution;

describe('bottom navigation destinations', () => {
  it('uses stable composite IDs and rebuilt hrefs for plugin contributions', () => {
    const destinations = buildNavDestinations([pluginEntry]);
    const plugin = destinations.find(
      (destination) => destination.id === pluginDestinationId('com.example.hello-orbit', 'hello-nav')
    );

    expect(plugin).toMatchObject({
      label: 'Hello',
      icon: 'sparkles-outline',
      href: '/plugin/com.example.hello-orbit?screen=home',
      source: 'plugin',
    });
  });

  it('always resolves exactly three unique slots', () => {
    const destinations = buildNavDestinations([pluginEntry]);
    const slots = resolveNavSlots(
      ['chat', pluginDestinationId('com.example.hello-orbit', 'hello-nav'), 'chat'],
      destinations
    );

    expect(slots).toHaveLength(BOTTOM_NAV_SLOT_COUNT);
    expect(new Set(slots.map((slot) => slot.destination.id)).size).toBe(BOTTOM_NAV_SLOT_COUNT);
    expect(slots[2].destination.id).not.toBe('chat');
  });

  it('falls back for unavailable plugin destinations but keeps the requested ID', () => {
    const saved = ['chat', 'plugin:removed.plugin:gone', 'tasks'];
    const slots = resolveNavSlots(saved, buildNavDestinations());

    expect(slots[1]).toMatchObject({
      requestedId: 'plugin:removed.plugin:gone',
      available: false,
    });
    expect(slots[1].destination.id).not.toBe('plugin:removed.plugin:gone');
    expect(unavailableNavIds(saved, buildNavDestinations())).toEqual([
      'plugin:removed.plugin:gone',
    ]);
  });

  it('normalizes drafts to three unique available IDs', () => {
    const ids = normalizeNavIds(
      ['tasks', 'tasks', 'plugin:removed.plugin:gone'],
      buildNavDestinations()
    );

    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(ids).not.toContain('plugin:removed.plugin:gone');
  });

  it('matches active paths without query strings', () => {
    expect(isNavPathActive('/chat?t=1', '/chat')).toBe(true);
    expect(isNavPathActive('/projects/1', '/projects')).toBe(true);
    expect(isNavPathActive('/', '/')).toBe(true);
    expect(isNavPathActive('/tasks', '/chat')).toBe(false);
    expect(BOTTOM_NAV_DEFAULT_IDS).toHaveLength(3);
  });
});
