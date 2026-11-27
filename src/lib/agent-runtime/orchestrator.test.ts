import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiSettings } from '../ai/settings';
import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import { AgentTurnCancelledError, runAgentTurn } from './orchestrator';
import { getAgentTask } from './task-manager';

const mocks = vi.hoisted(() => {
  const config = {
    userId: 1,
    agentId: 'master',
    instructions: '',
    memory: '',
    toolAccessMode: 'all' as const,
    allowedTools: ['memory_remember'],
    createdAt: 0,
    updatedAt: 0,
  };

  return {
    config,
    secureExecuteTool: vi.fn(),
    routeDeterministically: vi.fn(() => ({
      kind: 'handled' as const,
      calls: [{ toolName: 'memory_remember', args: { key: 'fact', value: 'remembered' } }],
      reply: '',
      traces: [],
    })),
    noop: vi.fn(async () => undefined),
  };
});

vi.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
vi.mock('expo-sqlite', () => ({ openDatabaseAsync: vi.fn() }));
vi.mock('expo-crypto', () => ({ randomUUID: () => `uuid-${Math.random().toString(36).slice(2)}` }));

vi.mock('../agent-settings', () => ({
  defaultAgentConfig: () => mocks.config,
  loadAgentConfig: async () => mocks.config,
  isToolAllowedForAgent: () => true,
  filterAllowedTools: (definitions: unknown[]) => definitions,
  newToolEventId: () => 'event-1',
  saveAgentConfig: async () => undefined,
}));
vi.mock('../ai/artifact-tools', () => ({ parseArtifactToolRef: () => null }));
vi.mock('../ai/local-agent', () => ({ runLocalAgent: vi.fn() }));
vi.mock('../ai/prompt', () => ({ buildSystemPrompt: () => 'system prompt' }));
vi.mock('../ai/providers', () => ({ requestCompletion: vi.fn() }));
vi.mock('../ai/settings', () => ({ isAiConfigured: () => false }));
vi.mock('../ai/tools', () => ({
  agentToolRegistry: {
    get: (name: string) => ({ definition: { name }, timeoutMs: 1_000 }),
    definitions: () => [],
    register: () => undefined,
  },
  executeTool: vi.fn(),
  listAgentTools: () => [],
}));
vi.mock('../ai/tool-registry', () => ({
  toolFail: (message: string) => JSON.stringify({ ok: false, error: message }),
}));
vi.mock('../buddy/store', () => ({ getActiveBuddy: async () => null }));
vi.mock('../cordis-tools', () => ({ buildCordisTools: () => [] }));
vi.mock('../events', () => ({
  EventStore: class {
    appendEvent = mocks.noop;
  },
}));
vi.mock('../hooks', () => ({
  HookEngine: class {
    executeHook = mocks.noop;
  },
}));
vi.mock('../memory/store', () => ({
  MemoryStore: class {
    importLegacyMemory = vi.fn(async () => false);
  },
}));
vi.mock('../memory/prompt', () => ({ buildMemoryPromptSection: async () => '' }));
vi.mock('../mcp/registry', () => ({ ensureMcpTools: mocks.noop }));
vi.mock('../policy', () => ({
  policyEngine: {
    evaluate: () => ({ decision: 'allow', ruleId: 'test', reason: 'allowed', ruleName: 'test' }),
  },
}));
vi.mock('../permissions/agents', () => ({
  MASTER_AGENT: { id: 'master', name: 'Master', description: '' },
}));
vi.mock('../permissions/executor', () => ({ secureExecuteTool: mocks.secureExecuteTool }));
vi.mock('../permissions/redact', () => ({ redactSecrets: (value: string) => value }));
vi.mock('../sandbox/adapters', () => ({ sandboxGate: mocks.noop }));
vi.mock('../skills', () => ({
  ensureBuiltinSkills: mocks.noop,
  registerDeclarativeSkillTools: async () => [],
  WEB_SEARCH_TOOL_NAME: 'skill_web_search_search_web',
}));
vi.mock('../skills/executor', () => ({ executeDeclarativeSkill: vi.fn() }));
vi.mock('../skills/manifest', () => ({ findSkillTool: () => null }));
vi.mock('../telemetry', () => ({
  TelemetryStore: class {
    recordToolCall = mocks.noop;
  },
}));
vi.mock('./capability-router', () => ({ routeDeterministically: mocks.routeDeterministically }));

let db: TestDatabase;

const turnInput = () => ({
  db,
  userId: 1,
  userName: 'Asha',
  history: [{ role: 'user' as const, content: 'Remember the backup code.' }],
  settings: {
    provider: 'ollama',
    mode: 'local',
    baseUrl: '',
    model: '',
    apiKey: '',
    webSearch: false,
  } satisfies AiSettings,
  conversationId: 7,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.routeDeterministically.mockReturnValue({
    kind: 'handled',
    calls: [{ toolName: 'memory_remember', args: { key: 'fact', value: 'remembered' } }],
    reply: '',
    traces: [],
  });
  mocks.secureExecuteTool.mockResolvedValue({
    success: true,
    content: '{"ok":true}',
    trace: 'remembered',
    durationMs: 4,
  });
});

afterEach(() => {
  db?.close();
});

describe('orchestrator completion rules', () => {
  it('completes only after a canonical verified tool envelope', async () => {
    db = createTestDatabase();

    const result = await runAgentTurn(turnInput());
    const task = await getAgentTask(db, result.taskId);

    expect(result.status).toBe('completed');
    expect(result.verification.verified).toBe(true);
    expect(task?.status).toBe('completed');
  });

  it('never claims completion for an unverified tool result', async () => {
    db = createTestDatabase();
    mocks.secureExecuteTool.mockResolvedValue({
      success: true,
      content: '{"ok":false,"error":"partial"}',
      trace: '',
      durationMs: 4,
    });

    const result = await runAgentTurn(turnInput());
    const task = await getAgentTask(db, result.taskId);

    expect(result.status).toBe('needs_review');
    expect(result.verification.verified).toBe(false);
    expect(result.verification.status).toBe('failed');
    expect(task?.status).toBe('needs_review');
  });

  it('keeps the durable task in review when cancellation follows a successful action', async () => {
    db = createTestDatabase();
    mocks.routeDeterministically.mockReturnValue({
      kind: 'handled',
      calls: [
        { toolName: 'memory_remember', args: { key: 'fact', value: 'remembered' } },
        { toolName: 'memory_remember', args: { key: 'fact2', value: 'second' } },
      ],
      reply: '',
      traces: [],
    });
    mocks.secureExecuteTool
      .mockResolvedValueOnce({
        success: true,
        content: '{"ok":true}',
        trace: 'remembered',
        durationMs: 4,
      })
      .mockRejectedValueOnce(new Error('Operation cancelled.'));

    let thrown: unknown = null;
    try {
      await runAgentTurn(turnInput());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AgentTurnCancelledError);
    const task = await getAgentTask(db, (thrown as AgentTurnCancelledError).taskId);
    expect(task?.status).toBe('needs_review');
    expect(task?.verification?.status).toBe('uncertain');
    expect(task?.verification?.verified).toBe(false);
    expect(task?.verification?.evidence).toMatchObject({ interrupted: true });
  });

  it('marks a task cancelled when the user stops it before any action completes', async () => {
    db = createTestDatabase();
    mocks.secureExecuteTool.mockRejectedValue(new Error('Operation cancelled.'));

    let thrown: unknown = null;
    try {
      await runAgentTurn(turnInput());
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AgentTurnCancelledError);
    const task = await getAgentTask(db, (thrown as AgentTurnCancelledError).taskId);
    expect(task?.status).toBe('cancelled');
    expect(task?.verification?.verified).toBe(false);
  });
});
