import { describe, expect, it } from 'vitest';

import type { PluginNavigationContribution } from './plugins/platform';
import {
  BOTTOM_NAV_DEFAULT_IDS,
  BOTTOM_NAV_SLOT_COUNT,
  buildNavDestinations,
  isBottomNavRoute,
  isNavPathActive,
  normalizeNavIds,
  normalizeNavPath,
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

describe('bottom navigation footer visibility', () => {
  it.each([
    '/',
    '/chat',
    '/tasks',
    '/workflows',
    '/marketplace',
    '/projects',
    '/conversations',
    '/connections',
    '/agents',
    '/plugins',
    '/artifacts',
    '/buddy',
  ])('shows the footer on the main screen %s', (pathname) => {
    expect(isBottomNavRoute(pathname)).toBe(true);
  });

  it.each([
    '/settings',
    '/settings/navigation',
    '/artifact',
    '/agent-action',
    '/agents/agent-1',
    '/agents/agent-1/tools',
    '/projects/project-1',
    '/plugins/plugin-1',
    '/plugin/plugin-1',
    '/buddy/tree',
    '/permissions',
    '/approvals',
    '/tool-permissions',
  ])('hides the footer on the detail screen %s', (pathname) => {
    expect(isBottomNavRoute(pathname)).toBe(false);
  });

  it('normalizes index routes, trailing slashes and query strings', () => {
    expect(normalizeNavPath('/index')).toBe('/');
    expect(normalizeNavPath('/chat/?n=1')).toBe('/chat');
    expect(isBottomNavRoute('/index')).toBe(true);
    expect(isBottomNavRoute('/chat/?n=1')).toBe(true);
    expect(isBottomNavRoute('/settings?tab=general')).toBe(false);
  });

  it('hides the footer while /chat holds an active conversation', () => {
    expect(isBottomNavRoute('/chat')).toBe(true);
    expect(isBottomNavRoute('/chat', { c: '7' })).toBe(false);
    expect(isBottomNavRoute('/chat', { n: '1' })).toBe(false);
    expect(isBottomNavRoute('/chat', { prompt: 'Explain this' })).toBe(false);
    expect(isBottomNavRoute('/chat', { h: '1' })).toBe(false);
  });
});
