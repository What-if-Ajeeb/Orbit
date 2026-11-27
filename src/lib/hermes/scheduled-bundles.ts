import { hashChain } from '../agent-runtime/hash';

import { builtinSkillBundles } from './skill-bundles';
import type { HermesSkillBundle } from './types';

export const MAX_SCHEDULED_BUNDLES = 4;
const BUNDLE_ID_PATTERN = /^bundle_[a-zA-Z0-9_.-]{1,119}$/;

/**
 * Parses schedule input into bounded, data-only bundle ids. This never creates
 * tools or skills: invalid input fails closed instead of widening disclosure.
 */
export function parseScheduledBundleIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_SCHEDULED_BUNDLES) {
    throw new Error('skillBundleIds must be an array of at most four identifiers.');
  }

  const ids = value.map((entry, index) => {
    if (typeof entry !== 'string' || !BUNDLE_ID_PATTERN.test(entry)) {
      throw new Error(`Invalid skill bundle id at index ${index}.`);
    }
    return entry;
  });
  if (new Set(ids).size !== ids.length) {
    throw new Error('skillBundleIds cannot contain duplicates.');
  }
  return ids;
}

/** Resolves ids against built-in bundles only; unknown ids are dropped. */
export function selectScheduledBundles(ids: string[]): HermesSkillBundle[] {
  const byId = new Map(builtinSkillBundles().map((bundle) => [bundle.id, bundle]));
  return ids
    .map((id) => byId.get(id))
    .filter((bundle): bundle is HermesSkillBundle => bundle !== undefined);
}

export function scheduledBundleFingerprint(ids: string[]): string {
  return hashChain({ skillBundleIds: ids });
}
