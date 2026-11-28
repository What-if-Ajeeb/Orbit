import type { SQLiteDatabase } from 'expo-sqlite';

import { buildSystemPrompt, type BuddyPromptContext } from '../ai/prompt';
import { hashChain } from '../agent-runtime/hash';
import { buildMemoryPromptSection } from '../memory/prompt';
import type { SkillManifest } from '../skills/manifest';

import {
  buildMemorySnapshot,
  formatMemorySnapshot,
  loadHermesMemorySnapshot,
} from './memory-budget';
import { formatSessionHits } from './session-search';
import {
  buildSkillBundleIndex,
  builtinSkillBundles,
  formatSkillBundleIndex,
  resolveSkillBundles,
} from './skill-bundles';
import { buildSkillIndex, formatSkillIndex, visibleSkillManifests } from './skill-catalog';
import type {
  HermesMemorySnapshot,
  HermesPromptBundle,
  HermesPromptTier,
  HermesSessionHit,
  HermesSkillBundle,
} from './types';

const MAX_PROMPT_CHARS = 24_000;

/** Disclosed in the harness snapshot so the bound is observable, not implicit. */
export const HERMES_PROMPT_LIMITS = { maxChars: MAX_PROMPT_CHARS } as const;

/**
 * Assembles a bounded system prompt once per turn. The timestamp, memory
 * snapshot and skill visibility are captured at build time and never refreshed
 * mid-turn, preserving a stable prefix the way Hermes freezes its snapshot.
 */
export async function buildHermesPromptBundle(input: {
  db: SQLiteDatabase;
  userId: number;
  agentId: string;
  projectId: string;
  userName: string;
  agentName: string;
  now?: number;
  buddyCtx?: BuddyPromptContext;
  instructions?: string;
  memoryNotes?: string;
  verifiedResults?: string[];
  manifests?: SkillManifest[];
  bundles?: HermesSkillBundle[];
  availableTools?: ReadonlySet<string>;
  availableToolsets?: ReadonlySet<string>;
  webSearchDisabled?: boolean;
  artifactCdnjsAllowed?: boolean;
  toolsetIds?: string[];
  memorySnapshot?: HermesMemorySnapshot;
  sessionHits?: HermesSessionHit[];
}): Promise<HermesPromptBundle> {
  const now = input.now ?? Date.now();
  const snapshot =
    input.memorySnapshot ??
    (await loadHermesMemorySnapshot({
      db: input.db,
      userId: input.userId,
      agentId: input.agentId,
      now,
    }).catch((error) => {
      console.warn('Could not load the Hermes memory snapshot.', error);
      return buildMemorySnapshot({ entries: [], frozenAt: now });
    }));
  const otherMemory = await buildMemoryPromptSection(
    input.db,
    input.userId,
    input.agentId,
    input.projectId,
    [],
    { excludeDurable: true }
  );
  const memory = [formatMemorySnapshot(snapshot), otherMemory].filter(Boolean).join('\n\n');
  const verifiedResults = input.verifiedResults ?? [];
  const sessionHits = input.sessionHits ?? [];

  const stablePrefix = buildSystemPrompt(input.userName, input.agentName, now, input.buddyCtx, {
    instructions: input.instructions,
    memory: input.memoryNotes,
    verifiedContext: [
      memory,
      verifiedResults.length > 0
        ? `Verified tool results:\n${verifiedResults.map((item) => `- ${item}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
    artifactCdnjsAllowed: input.artifactCdnjsAllowed === true,
  });

  const visible = visibleSkillManifests(input.manifests ?? [], {
    availableTools: input.availableTools,
    availableToolsets: input.availableToolsets,
    webSearchDisabled: input.webSearchDisabled,
  });
  const skillEntries = buildSkillIndex(visible);
  const bundles = resolveSkillBundles(input.bundles ?? builtinSkillBundles(), visible);
  const bundleEntries = buildSkillBundleIndex(bundles);
  const sections: { tier: HermesPromptTier; text: string }[] = [];

  if (input.toolsetIds && input.toolsetIds.length > 0) {
    sections.push({
      tier: 'toolsets',
      text: `Available toolsets for this turn: ${input.toolsetIds.join(', ')}.`,
    });
  }

  const skillIndex = formatSkillIndex(skillEntries);
  if (skillIndex) sections.push({ tier: 'skill-index', text: skillIndex });

  const bundleIndex = formatSkillBundleIndex(bundleEntries);
  if (bundleIndex) sections.push({ tier: 'skill-bundles', text: bundleIndex });

  const sessionText = formatSessionHits(sessionHits);
  if (sessionText) sections.push({ tier: 'session-search', text: sessionText });

  let system = stablePrefix;
  const tiers: HermesPromptTier[] = ['identity', 'context', 'memory', 'volatile'];
  for (const section of sections) {
    if (system.length + section.text.length + 2 > MAX_PROMPT_CHARS) break;
    system = `${system}\n\n${section.text}`;
    tiers.push(section.tier);
  }

  const fingerprint = hashChain({
    stablePrefix,
    memorySnapshot: snapshot.fingerprint,
    verifiedResults,
    skillEntries,
    bundleEntries,
    sessionHits,
    toolsetIds: input.toolsetIds ?? [],
    availableToolsets: input.availableToolsets ? Array.from(input.availableToolsets).sort() : [],
  });

  return {
    system,
    snapshotId: fingerprint.slice(0, 16),
    fingerprint,
    tiers,
    createdAt: now,
  };
}
