import { toolFail, toolOk, type AgentTool } from '../ai/tool-registry';
import { redactSecrets } from '../permissions/redact';
import { isMemoryScope, MEMORY_SCOPES, MemoryStore, type MemoryScope } from './store';

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function scopeArg(value: unknown, hasProject: boolean): MemoryScope {
  const scope = stringArg(value);
  if (isMemoryScope(scope)) return scope;
  return hasProject ? 'project' : 'agent';
}

function optionalScopeArg(value: unknown): MemoryScope | undefined {
  const scope = stringArg(value);
  return isMemoryScope(scope) ? scope : undefined;
}

export const MEMORY_REMEMBER_TOOL_NAME = 'memory_remember';
export const MEMORY_RECALL_TOOL_NAME = 'memory_recall';
export const MEMORY_FORGET_TOOL_NAME = 'memory_forget';

const rememberTool: AgentTool = {
  meta: { source: 'builtin' },
  definition: {
    name: MEMORY_REMEMBER_TOOL_NAME,
    description:
      'Store a user, agent, project, session, long-term, task-history or working memory. Use only for facts the caller wants retained. Secrets are redacted.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Short stable key, e.g. preferred_language.' },
        value: { type: 'string', description: 'Fact to remember.' },
        scope: { type: 'string', enum: [...MEMORY_SCOPES] },
        project_id: { type: 'string' },
        source: { type: 'string' },
        confidence: { type: 'number' },
        ttl_ms: { type: 'number' },
      },
      required: ['key', 'value'],
      additionalProperties: false,
    },
  },
  timeoutMs: 10_000,
  async execute(context, args) {
    const key = stringArg(args.key);
    const value = stringArg(args.value);
    if (!key || !value) return { content: toolFail('key and value are required.'), trace: '' };

    const projectId = stringArg(args.project_id);
    const scope = scopeArg(args.scope, Boolean(projectId));
    const confidence =
      typeof args.confidence === 'number' && Number.isFinite(args.confidence)
        ? args.confidence
        : 1;
    const ttlMs = typeof args.ttl_ms === 'number' && args.ttl_ms > 0 ? args.ttl_ms : null;

    try {
      const entry = await new MemoryStore(context.db).remember({
        userId: context.userId,
        agentId: context.agent?.id ?? 'master',
        projectId: projectId || null,
        scope,
        key,
        value,
        source: stringArg(args.source) || 'agent',
        confidence,
        ttlMs,
      });
      return {
        content: toolOk({
          id: entry.id,
          key: entry.key,
          scope: entry.scope,
          version: entry.version,
          project_id: entry.projectId,
        }),
        trace: `Remembered ${entry.scope} memory “${entry.key}”`,
      };
    } catch (error) {
      return {
        content: toolFail(error instanceof Error ? error.message : 'Could not store memory.'),
        trace: '',
      };
    }
  },
};

const recallTool: AgentTool = {
  meta: { source: 'builtin' },
  definition: {
    name: MEMORY_RECALL_TOOL_NAME,
    description: 'Recall memories for this user, agent, and optionally an explicit scope or project.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        scope: { type: 'string', enum: [...MEMORY_SCOPES] },
        project_id: { type: 'string' },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  timeoutMs: 10_000,
  async execute(context, args) {
    try {
      const projectId = stringArg(args.project_id);
      const scope = optionalScopeArg(args.scope);
      const entries = await new MemoryStore(context.db).recall({
        userId: context.userId,
        agentId: context.agent?.id ?? 'master',
        projectId: projectId || null,
        scope,
        key: stringArg(args.key) || undefined,
        limit: typeof args.limit === 'number' ? args.limit : 20,
      });
      return {
        content: toolOk({
          memories: entries.map((entry) => ({
            key: entry.key,
            value: redactSecrets(entry.value),
            scope: entry.scope,
            project_id: entry.projectId,
            version: entry.version,
            updated_at: entry.updatedAt,
          })),
        }),
        trace: `Recalled ${entries.length} memories`,
      };
    } catch (error) {
      return {
        content: toolFail(error instanceof Error ? error.message : 'Could not recall memory.'),
        trace: '',
      };
    }
  },
};

const forgetTool: AgentTool = {
  meta: { source: 'builtin' },
  definition: {
    name: MEMORY_FORGET_TOOL_NAME,
    description: 'Forget one memory by key and scope.',
    parameters: {
      type: 'object',
      properties: {
        key: { type: 'string' },
        scope: { type: 'string', enum: [...MEMORY_SCOPES] },
        project_id: { type: 'string' },
      },
      required: ['key'],
      additionalProperties: false,
    },
  },
  timeoutMs: 10_000,
  async execute(context, args) {
    const key = stringArg(args.key);
    if (!key) return { content: toolFail('key is required.'), trace: '' };

    const projectId = stringArg(args.project_id);
    const explicitScope = optionalScopeArg(args.scope);
    const scope: MemoryScope = explicitScope ?? (projectId ? 'project' : 'agent');

    try {
      const removed = await new MemoryStore(context.db).forget({
        userId: context.userId,
        agentId: context.agent?.id ?? 'master',
        projectId: projectId || null,
        scope,
        key,
      });
      return {
        content: toolOk({ removed, key, scope }),
        trace: removed ? `Forgot memory “${key}”` : 'No matching memory was found',
      };
    } catch (error) {
      return {
        content: toolFail(error instanceof Error ? error.message : 'Could not forget memory.'),
        trace: '',
      };
    }
  },
};

export const MEMORY_TOOLS: AgentTool[] = [rememberTool, recallTool, forgetTool];
