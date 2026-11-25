import { createAgentAction } from '@/lib/agent-actions/service';
import { listAgentActionIntegrations } from '@/lib/agent-actions/integrations';

import { toolOk } from './tool-registry';
import type { AgentTool } from './tool-registry';
import type { JsonSchema } from './types';

function newActionId(): string {
  const random =
    typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function'
      ? globalThis.crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);

  return `action_${Date.now()}_${random}`;
}

const parameters: JsonSchema = {
  type: 'object',
  properties: {
    actionId: { type: 'string', maxLength: 160 },
    kind: {
      type: 'string',
      enum: listAgentActionIntegrations().map((integration) => integration.kind),
    },
    payload: { type: 'object' },
  },
  required: ['kind', 'payload'],
  additionalProperties: false,
};

/**
 * Preparing a card has no external effect. The agent can describe a proposed
 * email, file, git or calendar action, but only a user confirmation on the card
 * can turn it into an executable action.
 */
export const AGENT_ACTION_PROPOSE_TOOL: AgentTool = {
  definition: {
    name: 'agent_action_propose',
    description:
      'Prepare an approval card for a sensitive action. This does not send, write, delete or execute anything. The user must review and confirm the exact payload on the card.',
    parameters,
  },
  meta: {
    source: 'builtin',
    permissions: ['agent.action.prepare'],
  },
  async execute(context, args) {
    const kind = typeof args.kind === 'string' ? args.kind.trim() : '';
    const payload =
      args.payload && typeof args.payload === 'object' && !Array.isArray(args.payload)
        ? (args.payload as Record<string, unknown>)
        : {};
    const id =
      typeof args.actionId === 'string' && args.actionId.trim()
        ? args.actionId.trim()
        : newActionId();

    const record = await createAgentAction(context.db, {
      id,
      userId: context.userId,
      conversationId: context.conversationId,
      agent: context.agent ?? {
        id: 'orbit-workspace',
        name: 'ORBIT workspace',
        role: 'master',
        description: 'Local workspace agent',
        icon: 'sparkles-outline',
      },
      kind,
      payload,
    });

    return {
      content: toolOk({
        actionId: record.id,
        status: record.status,
        title: record.title,
        target: record.target,
        note: 'Approval card prepared. Nothing was executed. The user must confirm it.',
      }),
      trace: `Action card ready · ${record.id}`,
    };
  },
};
