import { afterEach, describe, expect, it, vi } from 'vitest';

import { secureExecuteTool } from '../permissions/executor';
import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import { saveSkillManifestVersion } from '../skills';
import { executeDeclarativeSkill } from './executor';
import { parseSkillManifest, SKILL_MANIFEST_VERSION } from './manifest';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-skill-test' }));
vi.mock('../ai/tool-registry', () => ({
  agentToolRegistry: {
    get: (name: string) => ({ definition: { name } }),
    execute: vi.fn(async () => ({ content: '', trace: '' })),
    register: vi.fn(),
  },
  toolFail: (error: string) => JSON.stringify({ ok: false, error }),
  toolOk: (value: Record<string, unknown>) => JSON.stringify({ ok: true, ...value }),
}));
vi.mock('../permissions/executor', () => ({
  secureExecuteTool: vi.fn(),
}));
vi.mock('../policy', () => ({
  policyEngine: { evaluate: () => ({ decision: 'allow', ruleId: null, reason: '' }) },
}));
vi.mock('../sandbox/adapters', () => ({ sandboxGate: vi.fn(async () => {}) }));

let db: TestDatabase;

const skillId = 'skill_output_schema_test';

afterEach(() => {
  db?.close();
});

async function seed(outputSchema: Record<string, unknown>): Promise<void> {
  const manifest = parseSkillManifest({
    schemaVersion: SKILL_MANIFEST_VERSION,
    id: skillId,
    name: 'Output Skill',
    description: 'Checks declared outputs.',
    version: '1.0.0',
    enabled: true,
    autoLoad: false,
    capabilities: [
      {
        name: 'lookup',
        description: 'Look something up.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        outputSchema,
        steps: [{ tool: 'web_search', map: { query: 'query' } }],
      },
    ],
  });

  const now = Date.now();
  await db.runAsync(
    `INSERT INTO skills (id, name, description, version, capabilities, enabled, auto_load, created_at, updated_at)
     VALUES (?, 'Output Skill', 'Checks declared outputs.', '1.0.0', '[]', 1, 0, ?, ?)`,
    skillId,
    now,
    now
  );
  await saveSkillManifestVersion(db, manifest);
}

function context() {
  return {
    db,
    userId: 1,
    projectId: 'test-project',
    projectLabel: 'Test project',
    sandboxGate: vi.fn(async () => {}),
  };
}

describe('declarative skill outputSchema validation', () => {
  it('accepts a result that satisfies the declared output contract', async () => {
    db = createTestDatabase();
    await seed({
      type: 'object',
      properties: { ok: { type: 'boolean' }, answer: { type: 'string' } },
      required: ['answer'],
      additionalProperties: false,
    });
    vi.mocked(secureExecuteTool).mockResolvedValue({
      success: true,
      content: JSON.stringify({ ok: true, answer: 'yes' }),
      trace: '',
      durationMs: 1,
    } as Awaited<ReturnType<typeof secureExecuteTool>>);

    const result = await executeDeclarativeSkill(context(), skillId, 'lookup', { query: 'q' });
    expect(result.success).toBe(true);
  });

  it('fails cleanly when the result violates the declared output contract', async () => {
    db = createTestDatabase();
    await seed({
      type: 'object',
      properties: {
        ok: { type: 'boolean' },
        answer: { type: 'string' },
        status: { type: 'string', enum: ['ok'] },
      },
      required: ['answer'],
      additionalProperties: false,
    });
    vi.mocked(secureExecuteTool).mockResolvedValue({
      success: true,
      content: JSON.stringify({ ok: true, extra: 1 }),
      trace: '',
      durationMs: 1,
    } as Awaited<ReturnType<typeof secureExecuteTool>>);

    const result = await executeDeclarativeSkill(context(), skillId, 'lookup', { query: 'q' });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/outputSchema/);
  });
});
