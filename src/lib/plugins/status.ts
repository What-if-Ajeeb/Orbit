import type { PluginStatus } from './types';

/** Lifecycle states that mean a plugin is present on this device. */
const INSTALLED_STATUSES: ReadonlySet<PluginStatus> = new Set([
  'installed',
  'disabled',
  'enabling',
  'enabled',
  'starting',
  'running',
  'stopping',
  'error',
  'updating',
  'installing',
]);

export function isInstalledPluginStatus(status: PluginStatus): boolean {
  return INSTALLED_STATUSES.has(status);
}
