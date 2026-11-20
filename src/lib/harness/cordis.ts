import type { Context } from 'cordis';

import type { OrbitAgent } from './plugins/orbit-agent';
import type { OrbitLlm } from './plugins/orbit-llm';
import type { OrbitMcp } from './plugins/orbit-mcp';
import type { OrbitSession } from './plugins/orbit-session';
import type { OrbitTools } from './plugins/orbit-tools';

declare module 'cordis' {
  interface Context {
    tools: OrbitTools;
    llm: OrbitLlm;
    session: OrbitSession;
    mcp: OrbitMcp;
    agent: OrbitAgent;
  }

  interface Events {
    'session/created'(conversation: { id: number; title: string; createdAt: number }): void;
    'session/deleted'(conversationId: number): void;
    'tools/register'(context: { name: string }): void;
    'orbit/tools/register'(context: { name: string }): void;
    'orbit/tools/unregister'(context: { name: string }): void;
    'orbit/tools/change'(): void;
    'orbit/agent/created'(agent: { name: string; toolCount: number }): void;
    'orbit/agent/status'(agent: { status: 'ready' | 'idle' }): void;
    'orbit/agent/step'(agent: { toolName: string }): void;
    'orbit/agent/request'(agent: { toolCount: number }): void;
    'orbit/agent/turn-stopping'(): void;
  }
}

export type { Context };
export { Service } from 'cordis';
