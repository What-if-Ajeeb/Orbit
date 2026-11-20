import { Service, type Context } from 'cordis';

import { agentToolRegistry } from '@/lib/ai/tool-registry';
import type { AgentTool } from '@/lib/ai/tool-registry';

/**
 * Tool registry plugin. Built-in Orbit tools are registered during module
 * import of `ai/tools.ts`; this plugin mirrors the legacy static registry and
 * gives MCP servers a place to register themselves.
 */
export class OrbitTools extends Service {
  static readonly name = 'tools';

  constructor(ctx: Context) {
    super(ctx, 'tools');
  }

  register(tool: AgentTool): void {
    agentToolRegistry.register(tool, { replace: true });
    this.ctx.emit('orbit/tools/register', { name: tool.definition.name });
    this.ctx.emit('orbit/tools/change');
  }

  unregister(name: string): boolean {
    const removed = agentToolRegistry.unregister(name);

    if (removed) {
      this.ctx.emit('orbit/tools/unregister', { name });
      this.ctx.emit('orbit/tools/change');
    }

    return removed;
  }

  get(name: string): AgentTool | null {
    return agentToolRegistry.get(name);
  }

  definitions() {
    return agentToolRegistry.definitions();
  }
}
