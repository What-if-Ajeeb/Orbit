import type { AgentTool } from './ai/tool-registry';
import type { Plugin, Overlay } from './plugin-store';

export type MountedPlugin = {
  plugin: Plugin;
  tool?: AgentTool;
};

/**
 * Legacy in-memory overlay registry kept only for compatibility with old data
 * shapes. ORBIT 2.0 never mounts plugin code from here; the canonical registry
 * is `src/lib/plugins/registry.ts`.
 */
export class PluginRuntime {
  private plugins = new Map<number, MountedPlugin>();
  private overlays = new Map<string, Overlay[]>();

  mountPlugin(plugin: Plugin, tool?: AgentTool): void {
    this.plugins.set(plugin.id, { plugin, tool });
  }

  unmountPlugin(id: number): void {
    this.plugins.delete(id);
  }

  getPlugin(id: number): MountedPlugin | undefined {
    return this.plugins.get(id);
  }

  listMountedPlugins(): MountedPlugin[] {
    return Array.from(this.plugins.values());
  }

  registerOverlay(slot: string, overlay: Overlay): void {
    const existing = this.overlays.get(slot) ?? [];
    existing.push(overlay);
    this.overlays.set(slot, existing);
  }

  getOverlays(slot: string): Overlay[] {
    return this.overlays.get(slot) ?? [];
  }

  listAllOverlays(): Overlay[] {
    return Array.from(this.overlays.values()).flat();
  }

  removeOverlay(slot: string, id: number): void {
    const existing = this.overlays.get(slot);
    if (!existing) {
      return;
    }
    const next = existing.filter((o) => o.id !== id);
    if (next.length === 0) {
      this.overlays.delete(slot);
    } else {
      this.overlays.set(slot, next);
    }
  }
}

export const pluginRuntime = new PluginRuntime();
