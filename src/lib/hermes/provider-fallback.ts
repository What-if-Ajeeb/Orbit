import { BudgetExceededError } from '../agent-runtime/budgets';
import type { CompletionOptions } from '../ai/provider-registry';
import { requestCompletion } from '../ai/providers';
import type { AiSettings } from '../ai/settings';
import type { LlmMessage, LlmToolDefinition, LlmTurn } from '../ai/types';

import { buildProviderFallbackChain, isProviderCancellationError, smallTalkReply } from './provider-runtime';
import type { ProviderDiagnostic, ProviderErrorKind, ProviderRoute } from './types';

const FALLBACK_TEXT =
  'AI provider is unavailable right now. I can still handle deterministic local tasks, but I have not completed this request.';

function errorStatus(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
    ? status
    : undefined;
}

/**
 * Maps an error to a fixed category without persisting message text. Provider
 * errors are untrusted: their strings can contain URLs or response bodies.
 */
export function classifyProviderError(error: unknown): ProviderErrorKind {
  if (isProviderCancellationError(error)) return 'cancelled';

  const status = errorStatus(error);
  const message = error instanceof Error ? error.message : '';

  if (/timed?\s*out|timeout/i.test(message)) return 'timeout';
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limited';
  if (status === 404) return 'not_found';
  if (status === 400) return 'invalid_request';
  if (status !== undefined && status >= 500) return 'server';
  if (/could not reach|network|fetch failed/i.test(message)) return 'network';
  return 'unknown';
}

function diagnostic(
  route: ProviderRoute,
  outcome: ProviderDiagnostic['outcome'],
  input: {
    elapsedMs: number;
    errorKind?: ProviderErrorKind;
    status?: number;
    snapshotId?: string;
  }
): ProviderDiagnostic {
  return {
    route: route.fallback ? 'system' : 'primary',
    kind: route.kind,
    provider: route.provider,
    adapterId: route.adapterId,
    configured: route.configured,
    outcome,
    elapsedMs: Math.max(0, Math.round(input.elapsedMs)),
    ...(input.errorKind ? { errorKind: input.errorKind } : {}),
    ...(input.status === undefined ? {} : { status: input.status }),
    ...(input.snapshotId ? { snapshotId: input.snapshotId } : {}),
  };
}

function deterministicTurn(messages: LlmMessage[]): LlmTurn {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    const reply = smallTalkReply(message.content);
    return { text: reply ?? FALLBACK_TEXT, toolCalls: [] };
  }
  return { text: FALLBACK_TEXT, toolCalls: [] };
}

/**
 * Route-level fallback: try the one configured provider at most once, then
 * return deterministic system work. It never constructs a second network
 * route, executes a tool, or changes any permission/sandbox decision.
 *
 * Streaming deltas are buffered and released only on success, so a failed
 * provider cannot leave partial text that looks like a completed reply.
 */
export async function requestCompletionWithSystemFallback(input: {
  settings: AiSettings;
  messages: LlmMessage[];
  tools: LlmToolDefinition[];
  options?: CompletionOptions;
  snapshotId?: string;
  now?: () => number;
}): Promise<{ turn: LlmTurn; diagnostics: ProviderDiagnostic[]; usedFallback: boolean }> {
  const now = input.now ?? Date.now;
  const chain = buildProviderFallbackChain(input.settings);
  const primary = chain[0];
  const system = chain[chain.length - 1];

  if (!primary.configured) {
    return {
      turn: deterministicTurn(input.messages),
      diagnostics: [
        diagnostic(primary, 'skipped', { elapsedMs: 0, snapshotId: input.snapshotId }),
      ],
      usedFallback: true,
    };
  }

  const buffered: string[] = [];
  const options: CompletionOptions | undefined = input.options?.onTextDelta
    ? { ...input.options, onTextDelta: (delta) => buffered.push(delta) }
    : input.options;
  const started = now();

  try {
    const turn = await requestCompletion(input.settings, input.messages, input.tools, options);
    if (input.options?.onTextDelta) {
      for (const delta of buffered) input.options.onTextDelta(delta);
    }
    return {
      turn,
      diagnostics: [
        diagnostic(primary, 'succeeded', {
          elapsedMs: now() - started,
          snapshotId: input.snapshotId,
        }),
      ],
      usedFallback: false,
    };
  } catch (error) {
    // A user stop or budget/control-flow error must keep the existing
    // cancellation path; only provider failures can become system work.
    if (
      input.options?.signal?.aborted ||
      error instanceof BudgetExceededError ||
      isProviderCancellationError(error)
    ) {
      throw error;
    }

    return {
      turn: deterministicTurn(input.messages),
      diagnostics: [
        diagnostic(primary, 'failed', {
          elapsedMs: now() - started,
          errorKind: classifyProviderError(error),
          status: errorStatus(error),
          snapshotId: input.snapshotId,
        }),
        diagnostic(system, 'fallback', {
          elapsedMs: now() - started,
          snapshotId: input.snapshotId,
        }),
      ],
      usedFallback: true,
    };
  }
}
