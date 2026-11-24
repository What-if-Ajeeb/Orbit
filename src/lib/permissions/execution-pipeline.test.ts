import { describe, expect, it } from 'vitest';

import { formatPipeline, ToolExecutionPipeline } from './execution-pipeline';

describe('tool execution pipeline', () => {
  it('records ordered stages and a compact audit path', () => {
    let time = 0;
    const pipeline = new ToolExecutionPipeline('demo_tool', () => ++time);

    pipeline.enter('classify');
    pipeline.enter('authorize');
    pipeline.markExecuted();
    pipeline.enter('post_execute');
    pipeline.finish();

    const snapshot = pipeline.snapshot();

    expect(snapshot.entries.map((entry) => entry.stage)).toEqual([
      'classify',
      'authorize',
      'execute',
      'post_execute',
      'finalize',
    ]);
    expect(snapshot.executed).toBe(true);
    expect(snapshot.finalized).toBe(true);
    expect(snapshot.denial).toBeNull();
    expect(formatPipeline(snapshot)).toBe(
      'pipeline=classify>authorize>execute>post_execute>finalize'
    );
  });

  it('makes denials irreversible', () => {
    const pipeline = new ToolExecutionPipeline('demo_tool', () => 1);

    pipeline.enter('classify');
    pipeline.deny('user_denied', 'The user said no.');
    pipeline.finish();

    expect(() => pipeline.enter('authorize')).toThrow(/finalized/);
    expect(() => pipeline.markExecuted()).toThrow(/denied or completed/);
    expect(() => pipeline.deny('policy_denied')).toThrow(/reversed/);
    expect(() => pipeline.finish('again')).not.toThrow();

    const snapshot = pipeline.snapshot();

    expect(snapshot.denial).toBe('user_denied');
    expect(snapshot.executed).toBe(false);
    expect(snapshot.entries.filter((entry) => entry.stage === 'finalize')).toHaveLength(1);
    expect(formatPipeline(snapshot)).toContain('guard!');
  });

  it('rejects rewinding or repeating a stage', () => {
    const pipeline = new ToolExecutionPipeline('demo_tool', () => 1);

    pipeline.enter('classify');
    expect(() => pipeline.enter('classify')).toThrow(/out of order/);
    expect(() => pipeline.finish()).not.toThrow();
    expect(() => pipeline.enter('authorize')).toThrow(/finalized/);
  });
});
