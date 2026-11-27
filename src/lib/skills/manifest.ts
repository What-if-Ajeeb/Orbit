import type { JsonSchema, LlmToolDefinition } from '../ai/types';

export const SKILL_MANIFEST_VERSION = 1;
export const WEB_SEARCH_SKILL_ID = 'skill_web_search';
export const WEB_SEARCH_CAPABILITY = 'search_web';
export const WEB_SEARCH_TOOL_NAME = `${WEB_SEARCH_SKILL_ID}_${WEB_SEARCH_CAPABILITY}`;

/** Fields that would allow a manifest to turn into guest-code execution. */
const FORBIDDEN_FIELDS = new Set([
  'code',
  'script',
  'execute',
  'exec',
  'executable',
  'program',
  'handler',
  'callback',
  'function',
  'functions',
  'javascript',
  'js',
  'python',
  'wasm',
  'webassembly',
  'shell',
  'bash',
  'command',
  'commands',
  'node',
  'module',
  'import',
  'require',
  'eval',
]);

const FORBIDDEN_VALUES = /^\s*(?:function|class|=>|=>\s*\{|(?:async\s+)?function\s*\()/;

export type SkillStep = {
  tool: string;
  args?: Record<string, unknown>;
  /** Maps an output argument to a dot path in the capability input. */
  map?: Record<string, string>;
  optional?: boolean;
};

export type SkillCapabilityManifest = {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  /** Data-only output contract, checked with the limited validator in executor.ts. */
  outputSchema?: Record<string, unknown>;
  steps: SkillStep[];
};

export type SkillManifest = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  autoLoad: boolean;
  capabilities: SkillCapabilityManifest[];
};

function assertNoCodeFields(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoCodeFields(entry, `${path}[${index}]`));
    return;
  }

  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && FORBIDDEN_VALUES.test(value)) {
      throw new Error(`${path} contains an execution-shaped string.`);
    }
    return;
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_FIELDS.has(key.toLowerCase())) {
      throw new Error(`${path}.${key} is not allowed in a declarative skill manifest.`);
    }
    assertNoCodeFields(entry, `${path}.${key}`);
  }
}

function asObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, field: string, max = 500): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string.`);
  }
  return value.trim().slice(0, max);
}

/** Strictly validates a declarative, data-only skill manifest. */
export function parseSkillManifest(raw: unknown): SkillManifest {
  assertNoCodeFields(raw, 'manifest');
  const root = asObject(raw, 'manifest');

  if (root.schemaVersion !== SKILL_MANIFEST_VERSION) {
    throw new Error(`Unsupported skill manifest version: ${String(root.schemaVersion)}`);
  }

  const allowedRoot = new Set([
    'schemaVersion',
    'id',
    'name',
    'description',
    'version',
    'enabled',
    'autoLoad',
    'capabilities',
  ]);

  for (const key of Object.keys(root)) {
    if (!allowedRoot.has(key)) throw new Error(`Unknown skill manifest field: ${key}`);
  }

  if (!Array.isArray(root.capabilities) || root.capabilities.length === 0) {
    throw new Error('A skill needs at least one capability.');
  }
  if (root.capabilities.length > 20) {
    throw new Error('A skill cannot declare more than 20 capabilities.');
  }

  const capabilities: SkillCapabilityManifest[] = root.capabilities.map((entry, index) => {
    const cap = asObject(entry, `capabilities[${index}]`);
    const allowedCap = new Set(['name', 'description', 'inputSchema', 'outputSchema', 'steps']);
    for (const key of Object.keys(cap)) {
      if (!allowedCap.has(key)) {
        throw new Error(`Unknown capability field: ${key}`);
      }
    }
    if (!Array.isArray(cap.steps) || cap.steps.length === 0) {
      throw new Error(`Capability ${String(cap.name)} must declare at least one tool step.`);
    }
    if (cap.steps.length > 8) {
      throw new Error(`Capability ${String(cap.name)} cannot declare more than 8 steps.`);
    }

    const steps: SkillStep[] = cap.steps.map((stepEntry, stepIndex) => {
      const step = asObject(stepEntry, `steps[${stepIndex}]`);
      const allowedStep = new Set(['tool', 'args', 'map', 'optional']);
      for (const key of Object.keys(step)) {
        if (!allowedStep.has(key)) throw new Error(`Unknown step field: ${key}`);
      }
      const tool = asString(step.tool, 'step.tool', 200);
      if (!/^[a-zA-Z0-9_.-]+$/.test(tool)) {
        throw new Error(`Invalid tool name in skill step: ${tool}`);
      }
      return {
        tool,
        ...(step.args ? { args: asObject(step.args, 'step.args') } : {}),
        ...(step.map
          ? {
              map: Object.fromEntries(
                Object.entries(asObject(step.map, 'step.map')).map(([key, value]) => [
                  key,
                  asString(value, `step.map.${key}`, 120),
                ])
              ),
            }
          : {}),
        ...(step.optional === true ? { optional: true } : {}),
      };
    });

    return {
      name: asString(cap.name, 'capability.name', 80),
      description: asString(cap.description, 'capability.description', 500),
      inputSchema: asObject(cap.inputSchema, 'capability.inputSchema') as JsonSchema,
      ...(cap.outputSchema
        ? { outputSchema: asObject(cap.outputSchema, 'capability.outputSchema') }
        : {}),
      steps,
    };
  });

  return {
    schemaVersion: SKILL_MANIFEST_VERSION,
    id: asString(root.id, 'id', 120),
    name: asString(root.name, 'name', 120),
    description: asString(root.description, 'description', 1000),
    version: asString(root.version, 'version', 32),
    enabled: root.enabled !== false,
    autoLoad: root.autoLoad === true,
    capabilities,
  };
}

export function builtinSkillManifests(): SkillManifest[] {
  return [
    {
      schemaVersion: SKILL_MANIFEST_VERSION,
      id: 'skill_file_reader',
      name: 'File Reader',
      description: 'Read files from ORBIT-managed local storage through the Android sandbox.',
      version: '2.0.0',
      enabled: true,
      autoLoad: false,
      capabilities: [
        {
          name: 'read_file',
          description: 'Read a file from ORBIT’s document folder after sandbox approval.',
          inputSchema: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path'],
            additionalProperties: false,
          },
          steps: [{ tool: 'sandbox_read_file', map: { path: 'path' } }],
        },
      ],
    },
    {
      schemaVersion: SKILL_MANIFEST_VERSION,
      id: WEB_SEARCH_SKILL_ID,
      name: 'Web Search',
      description: 'Search the web through an explicitly connected search tool.',
      version: '2.0.0',
      enabled: true,
      autoLoad: false,
      capabilities: [
        {
          name: WEB_SEARCH_CAPABILITY,
          description: 'Search the internet using a connected, allowlisted search tool.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          },
          // No bundled search provider exists. The declarative executor reports
          // this honestly instead of fabricating results.
          steps: [{ tool: 'web_search', map: { query: 'query' } }],
        },
      ],
    },
    {
      schemaVersion: SKILL_MANIFEST_VERSION,
      id: 'skill_database_query',
      name: 'Database Query',
      description: 'Query an explicitly connected database tool.',
      version: '2.0.0',
      enabled: false,
      autoLoad: false,
      capabilities: [
        {
          name: 'query_db',
          description: 'Run a read-only query through a connected database tool.',
          inputSchema: {
            type: 'object',
            properties: { query: { type: 'string' } },
            required: ['query'],
            additionalProperties: false,
          },
          steps: [{ tool: 'database_query', map: { query: 'query' } }],
        },
      ],
    },
  ];
}

export function skillToolName(manifest: SkillManifest, capability: SkillCapabilityManifest): string {
  return `${manifest.id}_${capability.name}`;
}

export function declarativeToolDefinitions(manifest: SkillManifest): LlmToolDefinition[] {
  return manifest.capabilities.map((capability) => ({
    name: skillToolName(manifest, capability),
    description: capability.description,
    parameters: capability.inputSchema,
  }));
}

export function findSkillTool(
  toolName: string,
  manifests: SkillManifest[]
): { manifest: SkillManifest; capability: SkillCapabilityManifest } | null {
  for (const manifest of manifests) {
    for (const capability of manifest.capabilities) {
      if (skillToolName(manifest, capability) === toolName) return { manifest, capability };
    }
  }
  return null;
}
