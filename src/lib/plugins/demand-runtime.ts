import { loadMcpServers } from '@/lib/mcp/settings';

import { pluginApprovalService } from './approvals';
import { SmartPluginInstaller } from './demand';
import { getPluginPlatform, type PluginPlatformRuntime } from './platform';

const installers = new WeakMap<PluginPlatformRuntime, SmartPluginInstaller>();

/**
 * Returns the single demand installer for the active platform. It only reads
 * the existing registry, permission manager, approval queue and plugin KV
 * store; installation itself is delegated to `PluginRegistry.install/enable`.
 */
export function getSmartPluginInstaller(
  platform: PluginPlatformRuntime | null = getPluginPlatform()
): SmartPluginInstaller | null {
  if (!platform) {
    return null;
  }

  let installer = installers.get(platform);

  if (!installer) {
    installer = new SmartPluginInstaller({
      registry: platform.registry,
      permissions: platform.permissions,
      approvals: pluginApprovalService,
      storage: platform.storage,
      listServers: () => loadMcpServers(),
    });
    installers.set(platform, installer);
  }

  return installer;
}
