import type { AgentTool } from './ai/tool-registry';
import type { Plugin, Overlay } from './plugin-store';

export type MountedPlugin = {
  plugin: Plugin;
  tool?: AgentTool;
};

/**
 * Runtime registry for plugins mounted during a chat session. Creator mode
 * agents use cordis_* tools to write, install, and mount new plugins or UI
 * overlays live. Mounted tool plugins are registered into the agent tool
 * registry so the model can call them in the same session.
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
