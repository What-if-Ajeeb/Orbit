import type { Fiber } from 'cordis';
import { Context } from 'cordis';

import { OrbitAgent } from '../plugins/orbit-agent';
import { OrbitLlm } from '../plugins/orbit-llm';
import { OrbitMcp } from '../plugins/orbit-mcp';
import { OrbitSession } from '../plugins/orbit-session';
import { OrbitTools } from '../plugins/orbit-tools';

export type AppContextResult = {
  ctx: Context;
  fibers: Fiber[];
};

let app: AppContextResult | null = null;

export function getAppContext(): AppContextResult | null {
  return app;
}

export async function mountOrbitSpine(): Promise<AppContextResult> {
  if (app) {
    return app;
  }

  const ctx = new Context();
  const fibers: Fiber[] = [];

  fibers.push(await ctx.use(OrbitSession));
  fibers.push(await ctx.use(OrbitTools));
  fibers.push(await ctx.use(OrbitLlm));
  fibers.push(await ctx.use(OrbitMcp));
  fibers.push(await ctx.use(OrbitAgent));
  ctx.agent.announce('ready');

  app = { ctx, fibers };

  try {
    await ctx.mcp.sync();
  } catch (error) {
    console.warn('Initial MCP sync failed.', error);
  }

  return app;
}
