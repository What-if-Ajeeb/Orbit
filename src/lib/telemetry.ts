import type { SQLiteDatabase } from 'expo-sqlite';

export type ToolTelemetry = {
  toolName: string;
  durationMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  cacheHit: boolean | null;
  success: boolean;
  error?: string;
};

type ToolAggregate = {
  calls: number;
  totalDurationMs: number;
  errors: number;
};

export type TelemetrySummary = {
  totalTurns: number;
  totalSteps: number;
  totalToolCalls: number;
  totalDurationMs: number;
  avgDurationMs: number;
  totalTokensIn: number;
  totalTokensOut: number;
  cacheHits: number;
  cacheMisses: number;
  byTool: Record<string, ToolAggregate>;
  recent: ToolTelemetry[];
};

const estimateTokens = (text: string): number =>
  Math.max(1, Math.ceil(text.length / 4));

/**
 * Telemetry layered on top of the event store. Tool calls, token estimates
 * and cache hits are stored as `tool_call` / `ai_request` / `ai_response`
 * events so nothing needs a separate table — telemetry is just another view
 * over the event log.
 */
export class TelemetryStore {
  constructor(private db: SQLiteDatabase) {}

  async recordToolCall(
    userId: number,
    conversationId: number,
    toolName: string,
    durationMs: number,
    tokensIn: number | null,
    tokensOut: number | null,
    cacheHit: boolean | null,
    success: boolean,
    error?: string
  ): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO events (conversation_id, user_id, type, payload, created_at, sequence_number)
       VALUES (?, ?, 'tool_call', ?,
         (SELECT COALESCE(MAX(sequence_number), 0) + 1
          FROM events WHERE user_id = ? AND conversation_id = ?),
         ?)`,
      conversationId,
      userId,
      JSON.stringify({
        toolName,
        durationMs,
        tokensIn,
        tokensOut,
        cacheHit,
        success,
        error,
      }),
      userId,
      conversationId,
      Date.now()
    );
  }

  async getSummary(
    userId: number,
    conversationId?: number,
    days = 30
  ): Promise<TelemetrySummary> {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const convFilter = conversationId ? 'AND conversation_id = ?' : '';
    const params: (string | number)[] = [userId, since];
    if (conversationId) {
      params.push(conversationId);
    }

    const rows = (await this.db.getAllAsync(
      `SELECT type, payload FROM events
       WHERE user_id = ? AND created_at >= ? ${convFilter}
       ORDER BY sequence_number`,
      ...params
    )) as { type: string; payload: string }[];

    const summary: TelemetrySummary = {
      totalTurns: 0,
      totalSteps: 0,
      totalToolCalls: 0,
      totalDurationMs: 0,
      avgDurationMs: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      cacheHits: 0,
      cacheMisses: 0,
      byTool: {},
      recent: [],
    };

    const toolCalls: ToolTelemetry[] = [];

    for (const row of rows) {
      const payload =
        typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;

      if (row.type === 'turn_started') {
        summary.totalTurns += 1;
      }

      if (row.type === 'step_started') {
        summary.totalSteps += 1;
      }

      if (row.type === 'tool_call') {
        summary.totalToolCalls += 1;
        summary.totalDurationMs += payload.durationMs ?? 0;
        summary.totalTokensIn += payload.tokensIn ?? 0;
        summary.totalTokensOut += payload.tokensOut ?? 0;

        if (payload.cacheHit) {
          summary.cacheHits += 1;
        } else {
          summary.cacheMisses += 1;
        }

        const agg =
          summary.byTool[payload.toolName] ??
          ({ calls: 0, totalDurationMs: 0, errors: 0 } as ToolAggregate);
        agg.calls += 1;
        agg.totalDurationMs += payload.durationMs ?? 0;
        if (!payload.success) {
          agg.errors += 1;
        }
        summary.byTool[payload.toolName] = agg;

        toolCalls.push({
          toolName: payload.toolName,
          durationMs: payload.durationMs ?? 0,
          tokensIn: payload.tokensIn ?? null,
          tokensOut: payload.tokensOut ?? null,
          cacheHit: payload.cacheHit ?? null,
          success: payload.success,
          error: payload.error,
        });
      }
    }

    summary.avgDurationMs =
      summary.totalToolCalls > 0
        ? Math.round(summary.totalDurationMs / summary.totalToolCalls)
        : 0;
    summary.recent = toolCalls.slice(-20);

    return summary;
  }

  async recordAiRequest(
    userId: number,
    conversationId: number,
    messages: { role: string; content: string }[]
  ): Promise<void> {
    const tokensIn = messages.reduce(
      (sum, m) => sum + estimateTokens(m.content),
      0
    );
    await this.recordGeneric(
      userId,
      conversationId,
      'ai_request',
      { tokensIn, messageCount: messages.length }
    );
  }

  async recordAiResponse(
    userId: number,
    conversationId: number,
    text: string
  ): Promise<void> {
    const tokensOut = estimateTokens(text);
    await this.recordGeneric(
      userId,
      conversationId,
      'ai_response',
      { tokensOut, replyLength: text.length }
    );
  }

  private async recordGeneric(
    userId: number,
    conversationId: number,
    type: 'ai_request' | 'ai_response',
    payload: Record<string, unknown>
  ): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO events (conversation_id, user_id, type, payload, created_at, sequence_number)
       VALUES (?, ?, ?, ?,
         (SELECT COALESCE(MAX(sequence_number), 0) + 1
          FROM events WHERE user_id = ? AND conversation_id = ?),
         ?)`,
      conversationId,
      userId,
      type,
      JSON.stringify(payload),
      userId,
      conversationId,
      Date.now()
    );
  }
}
