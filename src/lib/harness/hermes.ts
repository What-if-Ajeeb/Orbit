import { hashChain } from '../agent-runtime/hash';
import { agentToolRegistry } from '../ai/tool-registry';
import type { AiSettings } from '../ai/settings';
import { HERMES_MEMORY_LIMITS } from '../hermes/memory-budget';
import { HERMES_PROMPT_LIMITS } from '../hermes/prompt-builder';
import { buildProviderFallbackChain, summarizeProviderRoute } from '../hermes/provider-runtime';
import { HERMES_SESSION_SEARCH_LIMITS } from '../hermes/session-search';
import {
  buildSkillBundleIndex,
  builtinSkillBundles,
  resolveSkillBundles,
} from '../hermes/skill-bundles';
import { buildSkillIndex, visibleSkillManifests } from '../hermes/skill-catalog';
import { availableToolNames, buildToolsets } from '../hermes/toolsets';
import type { HermesPromptTier } from '../hermes/types';
import { builtinSkillManifests } from '../skills/manifest';

import type { HermesContractSnapshot } from './types';

const PROMPT_TIERS: HermesPromptTier[] = [
  'identity',
  'context',
  'memory',
  'volatile',
  'toolsets',
  'skill-index',
  'skill-bundles',
  'session-search',
];

/**
 * Pure disclosure of the Hermes layer. Reads only static registries and
 * built-in declarative data: no DB reads, network calls, model calls, tool
 * execution, memory snapshots or permission changes.
 */
export function buildHermesContractSection(
  ai: AiSettings,
  now: number = Date.now()
): HermesContractSnapshot {
  const route = summarizeProviderRoute(ai);
  const toolNames = agentToolRegistry.definitions().map((definition) => definition.name);
  const toolsets = buildToolsets({ toolNames });
  const available = availableToolNames(toolsets);
  const manifests = visibleSkillManifests(builtinSkillManifests(), {
    availableTools: available,
    webSearchDisabled: ai.webSearch === false,
  });
  const bundles = resolveSkillBundles(builtinSkillBundles(), manifests);

  const descriptor = {
    provider: route,
    toolsetIds: toolsets.map((toolset) => toolset.id),
    registeredTools: toolNames.length,
    skillIds: buildSkillIndex(manifests).map((entry) => entry.id),
    bundleIds: buildSkillBundleIndex(bundles).map((entry) => entry.id),
    promptTiers: PROMPT_TIERS,
    memoryLimits: HERMES_MEMORY_LIMITS,
    sessionLimits: HERMES_SESSION_SEARCH_LIMITS,
  };

  return {
    provider: { ...route, routeCount: buildProviderFallbackChain(ai).length },
    toolsets: {
      ids: toolsets.map((toolset) => toolset.id),
      registeredCount: toolNames.length,
      availableCount: available.size,
    },
    skills: {
      visibleIds: manifests.map((manifest) => manifest.id),
      bundleIds: bundles.map((bundle) => bundle.id),
    },
    prompt: { tiers: [...PROMPT_TIERS], maxChars: HERMES_PROMPT_LIMITS.maxChars },
    memory: {
      agentChars: HERMES_MEMORY_LIMITS.agent,
      userChars: HERMES_MEMORY_LIMITS.user,
    },
    sessionSearch: { ...HERMES_SESSION_SEARCH_LIMITS },
    fingerprint: hashChain(descriptor),
    checkedAt: now,
  };
}
