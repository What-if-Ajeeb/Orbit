import type { AgentTaskVerification } from '../agent-runtime/types';
import {
  combineVerifications,
  verified,
  verificationFailed,
} from '../agent-runtime/verification';

import type { HybridTaskState } from './types';

/**
 * Hybrid verification never accepts a prose "success". Canonical tool
 * envelopes and skill output checks are the only evidence used by the loop.
 */
export function verifyPlanResults(
  results: AgentTaskVerification[],
  options: { notes?: string[]; noToolsReason?: string } = {}
): AgentTaskVerification {
  const base = combineVerifications(
    results,
    options.noToolsReason ?? 'No state-changing action was claimed.'
  );

  if (base.verified && options.notes?.length) {
    return {
      ...base,
      reason: `${base.reason} Notes: ${options.notes.join(' ')}`.slice(0, 1_000),
    };
  }
  return base;
}

export function verificationToState(verification: AgentTaskVerification): HybridTaskState {
  if (verification.verified) return 'COMPLETED';
  if (verification.status === 'failed') return 'FAILED';
  return 'BLOCKED';
}

export function assertVerificationBeforeCompletion(
  verification: AgentTaskVerification
): void {
  if (!verification.verified) {
    throw new Error(
      verificationFailed('A hybrid task cannot complete without verified evidence.').reason
    );
  }
}

export function conversationalVerification(): AgentTaskVerification {
  return verified('The reply was conversational; no state-changing action was claimed.');
}
