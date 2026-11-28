import { describe, expect, it } from 'vitest';

import { highlightCodeLine } from './highlight';

describe('artifact code highlighting', () => {
  it('marks keywords, numbers and capitalized types', () => {
    const tokens = highlightCodeLine('const answer = 42;', 'javascript');

    expect(tokens).toEqual([
      { text: 'const', kind: 'keyword' },
      { text: ' answer = ', kind: 'plain' },
      { text: '42', kind: 'number' },
      { text: ';', kind: 'plain' },
    ]);
  });

  it('keeps keywords inside strings and comments literal', () => {
    const code = highlightCodeLine('const text = "return 1"; // return now', 'js');
    const stringToken = code.find((token) => token.text === '"return 1"');
    const commentToken = code.find((token) => token.kind === 'comment');

    expect(stringToken?.kind).toBe('string');
    expect(commentToken?.text).toBe('// return now');
    expect(code.some((token) => token.text === 'return' && token.kind === 'keyword')).toBe(false);
  });

  it('recognizes Python comments and boolean literals in JSON', () => {
    expect(highlightCodeLine('# const note = 1', 'python')[0]).toEqual({
      text: '# const note = 1',
      kind: 'comment',
    });
    expect(highlightCodeLine('{"ok": true, "n": 2}', 'json')).toContainEqual({
      text: 'true',
      kind: 'keyword',
    });
  });

  it('falls back to a small generic keyword set for unknown languages', () => {
    expect(highlightCodeLine('return value', 'brainfuck')).toContainEqual({
      text: 'return',
      kind: 'keyword',
    });
  });
});
