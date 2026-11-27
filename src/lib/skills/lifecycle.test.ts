import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTestDatabase, type TestDatabase } from '../testing/node-sqlite';

import {
  activateSkillVersion,
  getActiveSkillManifests,
  getSkillLifecycleState,
  recordSkillEvaluation,
  rollbackSkillVersion,
  saveSkillManifestVersion,
  SkillStore,
} from '../skills';
import { parseSkillManifest, SKILL_MANIFEST_VERSION, type SkillManifest } from './manifest';

vi.mock('expo-crypto', () => ({ randomUUID: () => 'uuid-lifecycle-test' }));

let db: TestDatabase;

const skillId = 'skill_lifecycle_test';

function makeManifest(version: string): SkillManifest {
  return parseSkillManifest({
    schemaVersion: SKILL_MANIFEST_VERSION,
    id: skillId,
    name: 'Lifecycle Skill',
    description: 'A versioned data-only skill.',
    version,
    enabled: true,
    autoLoad: false,
    capabilities: [
      {
        name: 'lookup',
        description: 'Look something up.',
        inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
        steps: [{ tool: 'web_search', map: { query: 'query' } }],
      },
    ],
  });
}

async function seedVersions(): Promise<void> {
  const now = Date.now();
  for (const [index, version] of ['1.0.0', '2.0.0', '3.0.0'].entries()) {
    await saveSkillManifestVersion(db, makeManifest(version));
    db.raw
      .prepare('UPDATE skill_versions SET created_at = ? WHERE skill_id = ? AND version = ?')
      .run(now + index * 1_000, skillId, version);
  }
  await db.runAsync(
    `INSERT INTO skills (id, name, description, version, capabilities, enabled, auto_load, created_at, updated_at)
     VALUES (?, 'Lifecycle Skill', 'A versioned data-only skill.', '3.0.0', '[]', 1, 0, ?, ?)`,
    skillId,
    now,
    now
  );
}

afterEach(() => {
  db?.close();
});

describe('skill version lifecycle', () => {
  it('activates a validated immutable version and rolls back to the previous one', async () => {
    db = createTestDatabase();
    await seedVersions();

    const activated = await activateSkillVersion(db, skillId, '2.0.0');
    expect(activated).toMatchObject({ version: '2.0.0', previousVersion: '3.0.0', state: 'active' });
    expect((await getActiveSkillManifests(db))[0]?.version).toBe('2.0.0');

    const rolledBack = await rollbackSkillVersion(db, skillId);
    expect(rolledBack).toMatchObject({ version: '1.0.0', state: 'rolled_back' });
    expect((await getActiveSkillManifests(db))[0]?.version).toBe('1.0.0');
    expect(await getSkillLifecycleState(db, skillId)).toBe('rolled_back');
  });

  it('refuses to activate a version whose stored hash no longer matches', async () => {
    db = createTestDatabase();
    await seedVersions();
    db.raw
      .prepare('UPDATE skill_versions SET manifest_hash = ? WHERE skill_id = ? AND version = ?')
      .run('tampered', skillId, '2.0.0');

    await expect(activateSkillVersion(db, skillId, '2.0.0')).rejects.toThrow(/integrity check/);
    expect((await new SkillStore(db).getSkill(skillId))?.version).toBe('3.0.0');
  });

  it('records evaluations when the table exists and ignores a missing table', async () => {
    db = createTestDatabase();
    await seedVersions();

    expect(await recordSkillEvaluation(db, {
      skillId,
      success: true,
      score: 0.9,
      detail: { source: 'test' },
      userId: 1,
      taskId: 'task-1',
    })).toBe(false);

    db.raw.exec(`
      CREATE TABLE skill_evaluations (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL,
        version TEXT NOT NULL,
        manifest_hash TEXT NOT NULL,
        user_id INTEGER,
        task_id TEXT,
        success INTEGER NOT NULL,
        score REAL,
        detail TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    expect(await new SkillStore(db).recordEvaluation({
      skillId,
      success: true,
      score: 0.75,
      detail: 'passed',
    })).toBe(true);

    const row = await db.getFirstAsync<{ version: string; success: number; detail: string }>(
      'SELECT version, success, detail FROM skill_evaluations WHERE skill_id = ?',
      skillId
    );
    expect(row).toMatchObject({ version: '3.0.0', success: 1, detail: 'passed' });
  });
});
