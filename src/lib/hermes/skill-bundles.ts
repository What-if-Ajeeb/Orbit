import {
  asObject,
  asString,
  assertNoCodeFields,
  SKILL_MANIFEST_VERSION,
  WEB_SEARCH_SKILL_ID,
  type SkillManifest,
} from '../skills/manifest';

import type { HermesSkillBundle, SkillIndexEntry } from './types';

/**
 * Strictly validates a disclosure-only skill bundle. A bundle groups existing
 * data-only skills for progressive disclosure; it has no steps, tools, schema
 * or executable surface of its own.
 */
export function parseSkillBundleManifest(raw: unknown): HermesSkillBundle {
  assertNoCodeFields(raw, 'bundle');
  const root = asObject(raw, 'bundle');

  if (root.schemaVersion !== SKILL_MANIFEST_VERSION) {
    throw new Error(`Unsupported skill bundle version: ${String(root.schemaVersion)}`);
  }

  const allowed = new Set([
    'schemaVersion',
    'id',
    'name',
    'description',
    'version',
    'skills',
    'instruction',
  ]);
  for (const key of Object.keys(root)) {
    if (!allowed.has(key)) throw new Error(`Unknown skill bundle field: ${key}`);
  }

  if (!Array.isArray(root.skills) || root.skills.length === 0 || root.skills.length > 8) {
    throw new Error('A skill bundle must group between 1 and 8 skills.');
  }
  const skills = root.skills.map((entry, index) => {
    const id = asString(entry, `skills[${index}]`, 120);
    if (!/^[a-zA-Z0-9_.-]+$/.test(id)) throw new Error(`Invalid skill id in bundle: ${id}`);
    return id;
  });
  if (new Set(skills).size !== skills.length) {
    throw new Error('A skill bundle cannot repeat a skill id.');
  }

  const id = asString(root.id, 'id', 120);
  if (!/^bundle_[a-zA-Z0-9_.-]+$/.test(id)) {
    throw new Error(`Invalid skill bundle id: ${id}`);
  }

  return {
    schemaVersion: SKILL_MANIFEST_VERSION,
    id,
    name: asString(root.name, 'name', 120),
    description: asString(root.description, 'description', 500),
    version: asString(root.version, 'version', 32),
    skills,
    ...(root.instruction
      ? { instruction: asString(root.instruction, 'instruction', 500) }
      : {}),
  };
}

/** Bundles are built-in disclosure data; they are never persisted as skills. */
export function builtinSkillBundles(): HermesSkillBundle[] {
  return [
    parseSkillBundleManifest({
      schemaVersion: SKILL_MANIFEST_VERSION,
      id: 'bundle_research',
      name: 'Research workflow',
      description: 'Group local document reading with web search when connected.',
      version: '1.0.0',
      skills: ['skill_file_reader', WEB_SEARCH_SKILL_ID],
      instruction: 'Bundles are not callable tools. Load one member skill before using it.',
    }),
  ];
}

/**
 * Drops members that are not currently visible, then hides empty bundles. This
 * prevents a bundle from re-exposing a skill hidden by grants or settings.
 */
export function resolveSkillBundles(
  bundles: HermesSkillBundle[],
  visibleManifests: SkillManifest[]
): HermesSkillBundle[] {
  const visibleIds = new Set(visibleManifests.map((manifest) => manifest.id));
  return bundles
    .map((bundle) => ({ ...bundle, skills: bundle.skills.filter((id) => visibleIds.has(id)) }))
    .filter((bundle) => bundle.skills.length > 0);
}

export function buildSkillBundleIndex(bundles: HermesSkillBundle[]): SkillIndexEntry[] {
  return bundles.map((bundle) => ({
    id: bundle.id,
    name: bundle.name,
    description: bundle.description,
    capabilities: bundle.skills.map((id) => ({ name: id, description: 'Load this skill on request.' })),
    kind: 'bundle',
    skillIds: bundle.skills,
  }));
}

export function formatSkillBundleIndex(entries: SkillIndexEntry[], limit = 12): string {
  const selected = entries.slice(0, limit);
  if (selected.length === 0) return '';

  const lines = selected.map((entry) => {
    const members = (entry.skillIds ?? entry.capabilities.map((capability) => capability.name)).join(', ');
    return `- ${entry.id} — ${entry.name}: ${entry.description} [${members}]`;
  });
  const hidden = entries.length > selected.length ? `\n- +${entries.length - selected.length} more bundles available on request.` : '';

  return `Skill bundles (disclosure only; not callable tools):\n${lines.join('\n')}${hidden}`;
}

export function viewSkillBundle(
  bundles: HermesSkillBundle[],
  manifests: SkillManifest[],
  id: string
): string | null {
  const bundle = bundles.find((entry) => entry.id === id);
  if (!bundle) return null;

  const lines = bundle.skills.map((skillId) => {
    const manifest = manifests.find((entry) => entry.id === skillId);
    return manifest
      ? `  - ${skillId}: ${manifest.description}`
      : `  - ${skillId}: currently unavailable`;
  });
  const instruction = bundle.instruction ? `\n${bundle.instruction}` : '';
  return `Bundle ${bundle.id} (${bundle.version})\n${bundle.description}${instruction}\nSkills:\n${lines.join('\n')}`;
}
