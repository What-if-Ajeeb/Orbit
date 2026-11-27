import type { SQLiteDatabase } from 'expo-sqlite';

import { buildSystemPrompt, type BuddyPromptContext } from '../ai/prompt';
import { hashChain } from '../agent-runtime/hash';
import { buildMemoryPromptSection } from '../memory/prompt';
import type { SkillManifest } from '../skills/manifest';

import { buildSkillIndex, formatSkillIndex, visibleSkillManifests } from './skill-catalog';
import type { HermesPromptBundle, HermesPromptTier } from './types';

const MAX_PROMPT_CHARS = 24_000;

/**
 * Assembles a bounded system prompt once per turn. The timestamp and memory
 * snapshot are captured at build time and never refreshed mid-turn, preserving
 * a stable prefix the way Hermes freezes its session-start snapshot.
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
  availableTools?: ReadonlySet<string>;
  webSearchDisabled?: boolean;
  toolsetIds?: string[];
}): Promise<HermesPromptBundle> {
  const now = input.now ?? Date.now();
  const memory = await buildMemoryPromptSection(
    input.db,
    input.userId,
    input.agentId,
    input.projectId
  );
  const verifiedResults = input.verifiedResults ?? [];

  const stablePrefix = buildSystemPrompt(input.userName, input.agentName, now, input.buddyCtx, {
    instructions: input.instructions,
    memory: input.memoryNotes,
    verifiedContext: [
      memory,
      verifiedResults.length > 0 ? `Verified tool results:\n${verifiedResults.map((item) => `- ${item}`).join('\n')}` : '',
    ]
      .filter(Boolean)
      .join('\n\n'),
  });

  const visible = visibleSkillManifests(input.manifests ?? [], {
    availableTools: input.availableTools,
    webSearchDisabled: input.webSearchDisabled,
  });
  const skillEntries = buildSkillIndex(visible);
  const sections: { tier: HermesPromptTier; text: string }[] = [];

  if (input.toolsetIds && input.toolsetIds.length > 0) {
    sections.push({
      tier: 'toolsets',
      text: `Available toolsets for this turn: ${input.toolsetIds.join(', ')}.`,
    });
  }

  const skillIndex = formatSkillIndex(skillEntries);
  if (skillIndex) sections.push({ tier: 'skill-index', text: skillIndex });

  let system = stablePrefix;
  const tiers: HermesPromptTier[] = ['identity', 'context', 'memory', 'volatile'];
  for (const section of sections) {
    if (system.length + section.text.length + 2 > MAX_PROMPT_CHARS) break;
    system = `${system}\n\n${section.text}`;
    tiers.push(section.tier);
  }

  const fingerprint = hashChain({
    stablePrefix,
    memory,
    verifiedResults,
    skillEntries,
    toolsetIds: input.toolsetIds ?? [],
  });

  return {
    system,
    snapshotId: fingerprint.slice(0, 16),
    fingerprint,
    tiers,
    createdAt: now,
  };
}
