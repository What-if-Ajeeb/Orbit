import type {
  AgentTaskVerification,
  RuntimeToolCall,
  VerificationStatus,
} from './types';

function parseOk(content: string): boolean | null {
  try {
    const parsed = JSON.parse(content) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = (parsed as Record<string, unknown>).ok;
    return typeof value === 'boolean' ? value : null;
  } catch {
    return null;
  }
}

export function verified(
  reason: string,
  evidence: Record<string, unknown> = {}
): AgentTaskVerification {
  return { verified: true, status: 'verified', reason, evidence };
}

export function unverified(
  reason: string,
  evidence: Record<string, unknown> = {}
): AgentTaskVerification {
  return { verified: false, status: 'unverified', reason, evidence };
}

export function uncertain(
  reason: string,
  evidence: Record<string, unknown> = {}
): AgentTaskVerification {
  return { verified: false, status: 'uncertain', reason, evidence };
}

export function verificationFailed(
  reason: string,
  evidence: Record<string, unknown> = {}
): AgentTaskVerification {
  return { verified: false, status: 'failed', reason, evidence };
}

/**
 * A tool result is evidence only when it both completed without a failure code
 * and returned the host's canonical `{ ok: true }` envelope. Timeouts and
 * cancellations on external effects remain explicitly uncertain.
 */
export function verifyToolCall(call: RuntimeToolCall): AgentTaskVerification {
  const evidence = {
    toolName: call.toolName,
    durationMs: call.durationMs,
    policyDecision: call.policyDecision ?? null,
    error: call.error ?? null,
    errorCode: call.errorCode ?? null,
  };

  if (!call.success) {
    const uncertainExternal =
      call.errorCode === 'TOOL_TIMEOUT' || call.errorCode === 'TOOL_CANCELLED';
    return uncertainExternal
      ? uncertain('The tool stopped before verification; the external effect may have occurred.', evidence)
      : verificationFailed(call.error || `${call.toolName} failed.`, evidence);
  }

  const ok = parseOk(call.content);
  if (ok === true) {
    return verified(`${call.toolName} returned a verified success envelope.`, evidence);
  }

  if (ok === false) {
    return verificationFailed(`${call.toolName} reported failure.`, evidence);
  }

  return unverified(`${call.toolName} completed but did not return a verifiable envelope.`, evidence);
}

const RANK: Record<VerificationStatus, number> = {
  verified: 0,
  unverified: 1,
  uncertain: 2,
  failed: 3,
};

/** Returns the weakest verification so success can never be inferred from one good call. */
export function combineVerifications(
  values: AgentTaskVerification[],
  fallbackReason = 'No tool evidence was available.'
): AgentTaskVerification {
  if (values.length === 0) return unverified(fallbackReason);

  return values.reduce((weakest, next) =>
    RANK[next.status] > RANK[weakest.status] ? next : weakest
  );
}
