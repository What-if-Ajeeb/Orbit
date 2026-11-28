import { describe, expect, it } from 'vitest';

import { artifactTestDb } from '@/testing/artifact-db';

import { ArtifactStore, applyExactEdits } from './store';
import { ARTIFACT_CONTENT_MAX } from './types';

describe('applyExactEdits', () => {
  it('applies ordered, unique replacements', () => {
    expect(
      applyExactEdits('one two three', [
        { old: 'one', new: 'ONE' },
        { old: 'two', new: 'TWO' },
      ])
    ).toBe('ONE TWO three');
  });

  it('rejects malformed, empty, missing and ambiguous edits', () => {
    expect(() => applyExactEdits('abc', [])).toThrow(/non-empty array/);
    expect(() => applyExactEdits('abc', [{ old: 'a' }])).toThrow(/string `old` and `new`/);
    expect(() => applyExactEdits('abc', [{ old: '', new: 'x' }])).toThrow(/empty `old`/);
    expect(() => applyExactEdits('abc', [{ old: 'z', new: 'x' }])).toThrow(/Could not find/);
    expect(() => applyExactEdits('aba', [{ old: 'a', new: 'x' }])).toThrow(/appears more than once/);
  });
});

describe('ArtifactStore', () => {
  it('creates a scoped artifact with a normalized title and version 1', async () => {
    const { db, state, mocks } = artifactTestDb();
    const store = new ArtifactStore(db);

    const created = await store.create(1, {
      title: '  Page  ',
      type: 'html',
      content: '<p>hi</p>',
      conversationId: 7,
    });

    expect(created.title).toBe('Page');
    expect(created.currentVersion).toBe(1);
    expect(created.content).toBe('<p>hi</p>');
    expect(state.type).toBe('html');

    const insert = mocks.runAsync.mock.calls[0];
    expect(String(insert[0])).toContain('INSERT INTO artifacts');
    expect(insert[2]).toBe(1);
    expect(insert[3]).toBe(7);
  });

  it('rejects titles and content beyond the shared limits', async () => {
    const { db } = artifactTestDb();
    const store = new ArtifactStore(db);

    await expect(
      store.create(1, { title: 'x'.repeat(81), type: 'markdown', content: 'body' })
    ).rejects.toThrow(/at most 80/);
    await expect(
      store.create(1, { title: 'ok', type: 'markdown', content: 'x'.repeat(ARTIFACT_CONTENT_MAX + 1) })
    ).rejects.toThrow(/limit is 200000/);
  });

  it('adds a version and prunes beyond the 30-version window', async () => {
    const { db, state, executed } = artifactTestDb({ content: 'old', currentVersion: 30 });
    state.versions = Array.from({ length: 30 }, (_, index) => ({
      version: index + 1,
      content: 'x',
      summary: null,
    }));
    const store = new ArtifactStore(db);

    const updated = await store.addVersion(1, 'art_test', 'new', 'Rewrite');

    expect(updated.currentVersion).toBe(31);
    expect(updated.content).toBe('new');
    expect(executed.join('\n')).toContain('DELETE FROM artifact_versions');
    expect(state.versions).toHaveLength(30);
    expect(state.versions.some((entry) => entry.version === 1)).toBe(false);
  });

  it('appends text as one new version with a default summary', async () => {
    const { db, state } = artifactTestDb({ content: 'Hello' });
    const store = new ArtifactStore(db);

    const updated = await store.append(1, 'art_test', ' world');

    expect(updated.currentVersion).toBe(2);
    expect(state.content).toBe('Hello world');
    expect(state.versions.find((entry) => entry.version === 2)?.summary).toBe(
      'Appended (6 characters)'
    );
  });

  it('rejects appends that would exceed the total content limit', async () => {
    const { db } = artifactTestDb({ content: 'x'.repeat(ARTIFACT_CONTENT_MAX - 2) });
    const store = new ArtifactStore(db);

    await expect(store.append(1, 'art_test', '12345')).rejects.toThrow(/limit is 200000/);
    await expect(store.append(1, 'art_test', '   ')).rejects.toThrow(/non-empty string/);
  });

  it('applies exact edits through a single new version', async () => {
    const { db, state } = artifactTestDb({ content: 'Hello world' });
    const store = new ArtifactStore(db);

    const updated = await store.applyEdits(1, 'art_test', [
      { old: 'world', new: 'Orbit' },
    ]);

    expect(updated.currentVersion).toBe(2);
    expect(state.content).toBe('Hello Orbit');
    expect(state.versions.find((entry) => entry.version === 2)?.summary).toBe('Edited (1 change)');
  });
});
