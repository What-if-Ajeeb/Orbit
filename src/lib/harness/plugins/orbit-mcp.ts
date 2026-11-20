import { Service, type Context } from 'cordis';

import { refreshMcpTools, getMcpStatuses, getMcpToolCount } from '@/lib/mcp/registry';
import type { McpServerSyncStatus } from '@/lib/mcp/registry';
import type { McpServerConfig } from '@/lib/mcp/settings';

/**
 * MCP client plugin. Mirrors the legacy `mcp/registry` module: Orbit mounts
 * servers from SecureStore, syncs tool definitions onto the tool registry,
 * and exposes per-server statuses for the screens.
 */
export class OrbitMcp extends Service {
  static readonly name = 'mcp';

  constructor(ctx: Context) {
    super(ctx, 'mcp');
  }

  async sync(servers?: McpServerConfig[]): Promise<unknown> {
    return refreshMcpTools(servers);
  }

  get statuses(): McpServerSyncStatus[] {
    return getMcpStatuses();
  }

  get toolCount(): number {
    return getMcpToolCount();
  }
}
