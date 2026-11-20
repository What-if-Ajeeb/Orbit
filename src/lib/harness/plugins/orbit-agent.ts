import { Service, type Context } from 'cordis';

/** Minimal agent marker plugin. DeepSeek's AgentLoop is planned in Phase 2. */
export class OrbitAgent extends Service {
  static readonly name = 'agent';

  constructor(ctx: Context) {
    super(ctx, 'agent');
  }

  announce(status: 'ready' | 'idle' = 'ready'): void {
    this.ctx.emit('orbit/agent/status', { status });
  }
}
