/**
 * One-way pipeline state for a single agent tool call.
 *
 * The stages mirror the host-side guard order: classify → authorize →
 * pre-execute checks → monotonic guard → execute → post-execute → finalize.
 * A denial is irreversible and an executed call can never be authorized
 * again. The snapshot is embedded in the final tool result and the audit trail
 * so a decision can be reconstructed without reading the tool implementation.
 *
 * This is not a second runtime: it only records the ordering of checks that
 * `secureExecuteTool` already performs.
 */

import type { PermissionDenialReason } from './types';

export const TOOL_PIPELINE_STAGES = [
  'classify',
  'authorize',
  'pre_execute',
  'guard',
  'execute',
  'post_execute',
  'finalize',
] as const;

export type ToolPipelineStage = (typeof TOOL_PIPELINE_STAGES)[number];

export type ToolPipelineEntry = {
  stage: ToolPipelineStage;
  at: number;
  ok: boolean;
  detail?: string;
};

export type ToolPipelineSnapshot = {
  toolName: string;
  entries: ToolPipelineEntry[];
  denial: PermissionDenialReason | null;
  executed: boolean;
  finalized: boolean;
};

function stageIndex(stage: ToolPipelineStage): number {
  return TOOL_PIPELINE_STAGES.indexOf(stage);
}

function shortDetail(detail: string | undefined): string | undefined {
  if (!detail) {
    return undefined;
  }

  return detail.replace(/\s+/g, ' ').trim().slice(0, 200) || undefined;
}

export class ToolExecutionPipeline {
  private readonly entries: ToolPipelineEntry[] = [];
  private lastStage = -1;
  private denialReason: PermissionDenialReason | null = null;
  private executedCall = false;
  private finalizedCall = false;

  constructor(
    private readonly toolName: string,
    private readonly now: () => number = Date.now
  ) {}

  private record(stage: ToolPipelineStage, ok: boolean, detail?: string): void {
    const short = shortDetail(detail);

    this.entries.push({
      stage,
      at: this.now(),
      ok,
      ...(short ? { detail: short } : {}),
    });
  }

  /** Advances to a later stage. Re-entering or rewinding a stage is rejected. */
  enter(stage: ToolPipelineStage, detail?: string): void {
    if (this.finalizedCall) {
      throw new Error('A finalized tool pipeline cannot advance.');
    }

    if (this.denialReason && stage !== 'finalize') {
      throw new Error('A denied tool pipeline cannot advance to execution.');
    }

    const index = stageIndex(stage);

    if (index <= this.lastStage) {
      throw new Error(`Tool pipeline stage "${stage}" is out of order.`);
    }

    this.lastStage = index;
    this.record(stage, true, detail);
  }

  deny(reason: PermissionDenialReason, detail?: string): void {
    if (this.denialReason || this.executedCall || this.finalizedCall) {
      throw new Error('A tool decision cannot be reversed.');
    }

    this.denialReason = reason;
    this.lastStage = Math.max(this.lastStage, stageIndex('guard'));
    this.record('guard', false, detail ?? reason);
  }

  markExecuted(detail?: string): void {
    if (this.denialReason || this.executedCall || this.finalizedCall) {
      throw new Error('A denied or completed call cannot be executed again.');
    }

    this.enter('execute', detail);
    this.executedCall = true;
  }

  finish(detail?: string): void {
    if (this.finalizedCall) {
      return;
    }

    this.enter('finalize', detail);
    this.finalizedCall = true;
  }

  snapshot(): ToolPipelineSnapshot {
    return {
      toolName: this.toolName,
      entries: this.entries.map((entry) => ({ ...entry })),
      denial: this.denialReason,
      executed: this.executedCall,
      finalized: this.finalizedCall,
    };
  }
}

/** Compact, audit-friendly rendering of a pipeline snapshot. */
export function formatPipeline(snapshot: ToolPipelineSnapshot): string {
  const path = snapshot.entries
    .map((entry) => `${entry.stage}${entry.ok ? '' : '!'}`)
    .join('>');

  return `pipeline=${path || 'none'}${snapshot.denial ? ` denial=${snapshot.denial}` : ''}`;
}
