import type { Context } from 'cordis';

import { OrbitAgent } from '../../../../src/lib/harness/plugins/orbit-agent';
import { OrbitLlm } from '../../../../src/lib/harness/plugins/orbit-llm';
import { OrbitMcp } from '../../../../src/lib/harness/plugins/orbit-mcp';
import { OrbitSession } from '../../../../src/lib/harness/plugins/orbit-session';
import { OrbitTools } from '../../../../src/lib/harness/plugins/orbit-tools';

/**
 * Standalone plugin factory: mounts Orbit's five spine plugins. The in-app
 * boot (`src/lib/harness/spine/boot.tsx`) already mounts the same plugins.
 */
export async function OrbitApp(ctx: Context): Promise<void> {
  await ctx.use(OrbitSession);
  await ctx.use(OrbitTools);
  await ctx.use(OrbitLlm);
  await ctx.use(OrbitMcp);
  await ctx.use(OrbitAgent);
}
