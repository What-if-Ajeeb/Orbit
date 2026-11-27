import { Service, type Context } from 'cordis';

import type { RuntimeTurnInput, RuntimeTurnResult } from '@/lib/agent-runtime/types';

/**
 * Harness-facing facade for the central agent loop. The service owns no loop
 * logic; it emits Cordis lifecycle events around the orchestrator so the
 * existing spine can observe turns without reaching into the AI module.
 */
export class OrbitAgent extends Service {
  static readonly name = 'agent';

  constructor(ctx: Context) {
    super(ctx, 'agent');
  }

  announce(status: 'ready' | 'idle' | 'running' | 'needs_review' | 'failed' = 'ready'): void {
    this.ctx.emit('orbit/agent/status', { status });
  }

  step(toolName: string): void {
    this.ctx.emit('orbit/agent/step', { toolName });
  }

  request(toolCount: number): void {
    this.ctx.emit('orbit/agent/request', { toolCount });
  }

  turnStopping(): void {
    this.ctx.emit('orbit/agent/turn-stopping');
  }

  async run(input: RuntimeTurnInput): Promise<RuntimeTurnResult> {
    const [{ runAgentTurn }, { agentToolRegistry }] = await Promise.all([
      import('@/lib/agent-runtime/orchestrator'),
      import('@/lib/ai/tool-registry'),
    ]);
    this.request(agentToolRegistry.definitions().length);
    this.announce('running');

    try {
      const result = await runAgentTurn({
        ...input,
        onToolEvent: (event) => {
          this.step(event.toolName);
          input.onToolEvent?.(event);
        },
      });
      this.turnStopping();
      this.announce(result.status === 'completed' ? 'ready' : 'needs_review');
      return result;
    } catch (error) {
      this.turnStopping();
      this.announce('failed');
      throw error;
    }
  }
}
