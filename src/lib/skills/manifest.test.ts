import { describe, expect, it } from 'vitest';

import {
  builtinSkillManifests,
  declarativeToolDefinitions,
  findSkillTool,
  parseSkillManifest,
  SKILL_MANIFEST_VERSION,
  WEB_SEARCH_SKILL_ID,
  WEB_SEARCH_TOOL_NAME,
} from './manifest';

const validManifest = {
  schemaVersion: SKILL_MANIFEST_VERSION,
  id: 'skill_test',
  name: 'Test Skill',
  description: 'A data-only skill.',
  version: '1.0.0',
  enabled: true,
  autoLoad: false,
  capabilities: [
    {
      name: 'lookup',
      description: 'Look something up.',
      inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
      steps: [{ tool: 'web_search', map: { query: 'query' } }],
    },
  ],
};

describe('declarative skill manifests', () => {
  it('accepts every built-in manifest and derives stable tool names', () => {
    const manifests = builtinSkillManifests().map((manifest) => parseSkillManifest(manifest));
    const tools = manifests.flatMap(declarativeToolDefinitions);

    expect(manifests).toHaveLength(3);
    expect(tools.map((tool) => tool.name)).toContain(WEB_SEARCH_TOOL_NAME);
    expect(findSkillTool(WEB_SEARCH_TOOL_NAME, manifests)?.manifest.id).toBe(WEB_SEARCH_SKILL_ID);
  });

  it('rejects unknown fields and any execution-shaped field', () => {
    expect(() => parseSkillManifest({ ...validManifest, plugin: 'native' })).toThrow(
      /Unknown skill manifest field/
    );

    const withHandler = structuredClone(validManifest) as Record<string, unknown>;
    const capabilities = withHandler.capabilities as Record<string, unknown>[];
    (capabilities[0]!.steps as Record<string, unknown>[])[0]!.handler = 'function () {}';
    expect(() => parseSkillManifest(withHandler)).toThrow(/not allowed/);
  });

  it('rejects execution-shaped strings and invalid tool names', () => {
    const withCode = structuredClone(validManifest) as Record<string, unknown>;
    const codeCapabilities = withCode.capabilities as Record<string, unknown>[];
    const codeSteps = codeCapabilities[0]!.steps as Record<string, unknown>[];
    codeSteps[0]!.tool = '() => eval("bad")';
    expect(() => parseSkillManifest(withCode)).toThrow(/Invalid tool name/);

    const withFunctionValue = structuredClone(validManifest) as Record<string, unknown>;
    const valueCapabilities = withFunctionValue.capabilities as Record<string, unknown>[];
    const valueSteps = valueCapabilities[0]!.steps as Record<string, unknown>[];
    valueSteps[0]!.args = { text: 'function run() {}' };
    expect(() => parseSkillManifest(withFunctionValue)).toThrow(/execution-shaped/);
  });

  it('requires a real tool step and a supported schema version', () => {
    const withoutSteps = structuredClone(validManifest) as Record<string, unknown>;
    const capabilities = withoutSteps.capabilities as Record<string, unknown>[];
    capabilities[0]!.steps = [];
    expect(() => parseSkillManifest(withoutSteps)).toThrow(/at least one tool step/);
    expect(() => parseSkillManifest({ ...validManifest, schemaVersion: 2 })).toThrow(
      /Unsupported skill manifest version/
    );
  });
});
