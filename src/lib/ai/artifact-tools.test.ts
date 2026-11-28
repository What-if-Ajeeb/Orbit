import { describe, expect, it } from 'vitest';

import { artifactTestDb } from '@/testing/artifact-db';

import { ARTIFACT_TOOLS, parseArtifactToolRef } from './artifact-tools';
import type { AgentTool } from './tool-registry';

function getTool(name: string): AgentTool {
  const found = ARTIFACT_TOOLS.find((tool) => tool.definition.name === name);

  if (!found) {
    throw new Error(`Missing artifact tool: ${name}`);
  }

  return found;
}

function parsePayload(content: string): Record<string, unknown> {
  return JSON.parse(content) as Record<string, unknown>;
}

describe('artifact tools', () => {
  it('exposes read pagination and append alongside the existing tools', () => {
    expect(ARTIFACT_TOOLS.map((tool) => tool.definition.name)).toEqual([
      'artifact_create',
      'artifact_update',
      'artifact_edit',
      'artifact_read',
      'artifact_append',
      'artifact_list',
    ]);

    const read = getTool('artifact_read');
    const properties = (read.definition.parameters as { properties?: Record<string, unknown> })
      .properties;

    expect(Object.keys(properties ?? {})).toEqual(['id', 'start', 'max_chars']);
    expect(getTool('artifact_append').definition.parameters.required).toEqual(['id', 'content']);
  });

  it('reads a bounded page and reports total length and the next offset', async () => {
    const longContent = 'a'.repeat(70_000);
    const { db } = artifactTestDb({ content: longContent, type: 'html' });
    const read = getTool('artifact_read');

    const first = parsePayload(
      (await read.execute({ db, userId: 1 }, { id: 'art_test' })).content
    );

    expect(first.total_length).toBe(70_000);
    expect((first.content as string).length).toBe(60_000);
    expect(first.content_truncated).toBe(true);
    expect(first.next_start).toBe(60_000);

    const second = parsePayload(
      (
        await read.execute(
          { db, userId: 1 },
          { id: 'art_test', start: 60_000, max_chars: 20_000 }
        )
      ).content
    );

    expect(second.start).toBe(60_000);
    expect(second.max_chars).toBe(20_000);
    expect((second.content as string).length).toBe(10_000);
    expect(second.content_truncated).toBe(false);
    expect(second.next_start).toBeNull();
  });

  it('clamps invalid pagination values instead of failing the turn', async () => {
    const { db } = artifactTestDb({ content: 'abcdef' });

    const payload = parsePayload(
      (
        await getTool('artifact_read').execute(
          { db, userId: 1 },
          { id: 'art_test', start: -5, max_chars: 2 }
        )
      ).content
    );

    expect(payload.start).toBe(0);
    expect(payload.content).toBe('ab');
    expect(payload.next_start).toBe(2);
  });

  it('appends text through a new version and returns a parsable artifact ref', async () => {
    const { db, state } = artifactTestDb({ content: 'Hello' });

    const result = await getTool('artifact_append').execute(
      { db, userId: 1 },
      { id: 'art_test', content: ' world', summary: 'Added greeting' }
    );
    const payload = parsePayload(result.content);

    expect(payload.ok).toBe(true);
    expect(payload.version).toBe(2);
    expect(state.content).toBe('Hello world');
    expect(result.trace).toContain('Appended');
    expect(parseArtifactToolRef(result.content)).toEqual({
      id: 'art_test',
      title: 'Test artifact',
      type: 'markdown',
      version: 2,
    });
  });

  it('returns a structured failure for a missing artifact id', async () => {
    const { db } = artifactTestDb();

    const result = await getTool('artifact_read').execute({ db, userId: 1 }, {});

    expect(parsePayload(result.content)).toEqual({ ok: false, error: 'id is required.' });
    expect(parseArtifactToolRef(result.content)).toBeNull();
  });
});
