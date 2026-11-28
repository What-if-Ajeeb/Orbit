import { describe, expect, it } from 'vitest';

import { describeToolProgress } from './tool-progress';

describe('artifact tool progress', () => {
  it('describes an artifact being created without leaking its content', () => {
    const progress = describeToolProgress('artifact_create', {
      title: '  Launch  plan  ',
      type: 'html',
      content: 'const secret = "never show this";',
    });

    expect(progress.summary).toBe('Creating “Launch plan”');
    expect(progress.detail).toContain('Page');
    expect(progress.detail).toContain('33 characters');
    expect(progress.detail).not.toContain('secret');
  });

  it('includes a scoped id for changes to an existing artifact', () => {
    expect(describeToolProgress('artifact_update', { id: 'art_123', content: 'new body' })).toEqual({
      summary: 'Replacing artifact art_123',
      detail: '8 characters',
    });
    expect(describeToolProgress('artifact_edit', { id: 'art_123', edits: [{ old: 'a', new: 'b' }] })).toEqual({
      summary: 'Editing artifact art_123',
      detail: '1 exact change',
    });
  });

  it('keeps read and list operations short and bounded', () => {
    expect(describeToolProgress('artifact_read', { id: 'art_1' })).toEqual({
      summary: 'Reading artifact art_1',
    });
    expect(describeToolProgress('artifact_list', {})).toEqual({ summary: 'Listing artifacts' });

    const long = describeToolProgress('artifact_update', {
      id: 'x'.repeat(200),
      content: 'ok',
    });
    expect(long.summary.length).toBeLessThanOrEqual(80);
    expect(long.summary).toContain('…');
  });

  it('falls back to the tool name for non-artifact calls', () => {
    expect(describeToolProgress('search_web', { query: 'weather' })).toEqual({
      summary: 'Running search_web',
    });
  });
});
