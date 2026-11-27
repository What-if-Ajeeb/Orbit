import { WEB_SEARCH_SKILL_ID, type SkillManifest } from '../skills/manifest';

import type { SkillIndexEntry } from './types';

/**
 * Hermes-style progressive disclosure over ORBIT's data-only manifests.
 * Level 0 is the index, level 1 one skill, level 2 one capability. No level
 * loads or executes code: manifests were already validated by
 * `parseSkillManifest()` before they reach this module.
 */

function requiredTools(manifest: SkillManifest): string[] {
  return manifest.capabilities.flatMap((capability) =>
    capability.steps.filter((step) => !step.optional).map((step) => step.tool)
  );
}

/**
 * Hides skills whose required tools are unavailable and the web-search skill
 * when web search is disabled. This mirrors Hermes' conditional activation but
 * stays purely declarative.
 */
export function visibleSkillManifests(
  manifests: SkillManifest[],
  options: { availableTools?: ReadonlySet<string>; webSearchDisabled?: boolean } = {}
): SkillManifest[] {
  return manifests.filter((manifest) => {
    if (!manifest.enabled) return false;
    if (options.webSearchDisabled && manifest.id === WEB_SEARCH_SKILL_ID) return false;
    if (!options.availableTools) return true;
    return requiredTools(manifest).every((tool) => options.availableTools?.has(tool) === true);
  });
}

/** Level 0: short index suitable for a bounded system prompt. */
export function buildSkillIndex(manifests: SkillManifest[]): SkillIndexEntry[] {
  return manifests.map((manifest) => ({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    capabilities: manifest.capabilities.map((capability) => ({
      name: capability.name,
      description: capability.description,
    })),
  }));
}

export function formatSkillIndex(entries: SkillIndexEntry[], limit = 12): string {
  const selected = entries.slice(0, limit);
  if (selected.length === 0) return '';

  const lines = selected.map((entry) => {
    const caps = entry.capabilities
      .slice(0, 3)
      .map((capability) => capability.name)
      .join(', ');
    return `- ${entry.id} — ${entry.name}: ${entry.description}${caps ? ` [${caps}]` : ''}`;
  });
  const hidden = entries.length > selected.length ? `\n- +${entries.length - selected.length} more skills available on request.` : '';

  return `Skills (progressive disclosure; ask to load one before using it):\n${lines.join('\n')}${hidden}`;
}

/** Level 1: one skill's declarative capabilities. */
export function viewSkill(manifests: SkillManifest[], id: string): string | null {
  const manifest = manifests.find((entry) => entry.id === id);
  if (!manifest) return null;

  const capabilities = manifest.capabilities
    .map((capability) => `  - ${capability.name}: ${capability.description}`)
    .join('\n');
  return `Skill ${manifest.id} (${manifest.version})\n${manifest.description}\nCapabilities:\n${capabilities}`;
}

/** Level 2: one capability's data-only steps, without argument values. */
export function viewSkillCapability(
  manifests: SkillManifest[],
  id: string,
  capabilityName: string
): string | null {
  const manifest = manifests.find((entry) => entry.id === id);
  const capability = manifest?.capabilities.find((entry) => entry.name === capabilityName);
  if (!manifest || !capability) return null;

  const steps = capability.steps
    .map(
      (step) =>
        `  ${step.optional ? '[optional] ' : ''}${step.tool}${
          Object.keys(step.map ?? {}).length > 0 ? ` → ${Object.keys(step.map ?? {}).join(', ')}` : ''
        }`
    )
    .join('\n');
  return `Skill ${manifest.id} / ${capability.name}\n${capability.description}\nSteps:\n${steps}`;
}
