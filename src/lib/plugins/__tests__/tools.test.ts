import { describe, expect, it, vi } from 'vitest';

import { MissingPluginPermissionsError } from '../permissions';
import {
  assertToolCanRegister,
  buildPluginAgentTool,
  isValidPluginToolName,
  namespacedPluginToolName,
  pluginToolNamespace,
  type BuildPluginToolInput,
} from '../tools';
import type { PluginManifest } from '../types';
import { createHarness, createToolHost, makeManifest } from './helpers';

const context = { db: {} as never, userId: 1 };

function makeTool(overrides: Partial<BuildPluginToolInput> = {}) {
  const input: BuildPluginToolInput = {
    pluginId: 'test.plugin',
    pluginName: 'Test Plugin',
    trustLevel: 'local',
    definition: {
      name: 'search',
      description: 'Search the index.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string' } },
        required: ['query'],
        additionalProperties: false,
      },
      execute: async () => ({ content: '{"answer":42}', trace: 'searched' }),
    },
    grantedPermissions: () => ['ai.invoke'],
    assertPermission: () => undefined,
    isActive: () => true,
    requiresApproval: async () => true,
    log: () => undefined,
    ...overrides,
  };

  return { input, tool: buildPluginAgentTool(input) };
}

function builtinWithTools(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return makeManifest({
    pluginId: 'builtin.plugin',
    entryPoint: { kind: 'builtin', moduleId: 'builtin-module' },
    permissions: ['ai.invoke', 'storage.read'],
    ...overrides,
  });
}

describe('plugin tool namespacing and provenance', () => {
  it('validates local names and builds stable owned names', () => {
    expect(isValidPluginToolName('search_tool-2')).toBe(true);
    expect(isValidPluginToolName('2search')).toBe(false);
    expect(isValidPluginToolName('has space')).toBe(false);
    expect(isValidPluginToolName('../evil')).toBe(false);
    expect(pluginToolNamespace('my.plugin')).toBe('plugin__my_plugin__');
    expect(pluginToolNamespace('!!!')).toBe('plugin__unknown__');
    expect(namespacedPluginToolName('my.plugin', 'search')).toBe(
      'plugin__my_plugin__search'
    );
    expect(() => namespacedPluginToolName('my.plugin', 'bad name')).toThrow(/must match/);
    expect(() => namespacedPluginToolName('x'.repeat(40), 'a'.repeat(40))).toThrow(
      /longer than 64/
    );
  });

  it('prevents replacement of core tools and other namespaced tools', () => {
    const host = createToolHost();
    expect(() => assertToolCanRegister(host, 'core_tool')).toThrow(/plugin__ namespace/);

    const { tool } = makeTool();
    host.register(tool);
    expect(() => assertToolCanRegister(host, tool.definition.name)).toThrow(
      /already registered/
    );
    expect(() => assertToolCanRegister(host, pluginToolNamespace('other.plugin') + 'tool')).not.toThrow();
  });

  it('exposes provenance and a namespaced, described definition', () => {
    const { tool } = makeTool();

    expect(tool.meta).toEqual({
      source: 'plugin',
      pluginId: 'test.plugin',
      trustLevel: 'local',
      permissions: ['ai.invoke'],
    });
    expect(tool.definition.name).toBe('plugin__test_plugin__search');
    expect(tool.definition.description).toBe('[Test Plugin] Search the index.');
  });
});

describe('plugin tool execution wrapper', () => {
  it('validates inputs, checks permissions and returns raw plugin results', async () => {
    const assertPermission = vi.fn();
    const { tool } = makeTool({
      definition: {
        name: 'search',
        description: 'Search the index.',
        parameters: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
          additionalProperties: false,
        },
        permissions: ['storage.read'],
        execute: async () => ({ content: '{"answer":42}', trace: 'searched' }),
      },
      assertPermission,
    });

    expect(await tool.execute(context, { query: 'orbit' })).toEqual({
      content: '{"answer":42}',
      trace: 'searched',
    });
    expect(assertPermission.mock.calls.map(([permission]) => permission)).toEqual([
      'ai.invoke',
      'storage.read',
    ]);

    const invalid = await tool.execute(context, { query: 7, extra: true });
    expect(JSON.parse(invalid.content)).toMatchObject({ ok: false });
    expect(invalid.trace).toMatch(/rejected invalid arguments/);
  });

  it('blocks calls when the plugin is stopped or a permission is missing', async () => {
    const stopped = makeTool({ isActive: () => false }).tool;
    const stoppedResult = await stopped.execute(context, { query: 'x' });
    expect(stoppedResult.trace).toMatch(/plugin stopped/);
    expect(JSON.parse(stoppedResult.content).error).toMatch(/is not running/);

    const denied = makeTool({
      assertPermission: () => {
        throw new Error('permission missing');
      },
    }).tool;
    const deniedResult = await denied.execute(context, { query: 'x' });
    expect(JSON.parse(deniedResult.content).error).toMatch(/permission missing/);
  });

  it('asks for approval and honours a denial', async () => {
    const requiresApproval = vi.fn(async () => false);
    const execute = vi.fn(async () => ({ content: '{}', trace: 'ran' }));
    const { input: _input, tool } = makeTool({
      definition: {
        name: 'search',
        description: 'Search the index.',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
        requiresApproval: true,
        execute,
      },
      requiresApproval,
    });
    void _input;

    const denied = await tool.execute(context, { query: 'x' });
    expect(JSON.parse(denied.content).error).toMatch(/denied this plugin action/);
    expect(execute).not.toHaveBeenCalled();
    expect(requiresApproval).toHaveBeenCalledWith('search');

    requiresApproval.mockResolvedValue(true);
    expect(await tool.execute(context, { query: 'x' })).toEqual({
      content: '{}',
      trace: 'ran',
    });
  });

  it('cancels work when the caller aborts', async () => {
    const execute = vi.fn(
      (_args: Record<string, unknown>, sdkContext: { signal?: AbortSignal }) =>
        new Promise<{ content: string; trace: string }>((_resolve, reject) => {
          sdkContext.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const { tool } = makeTool({
      definition: {
        name: 'search',
        description: 'Search the index.',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
        execute,
      },
    });
    const controller = new AbortController();

    const running = tool.execute({ ...context, signal: controller.signal }, { query: 'x' });
    controller.abort();
    const result = await running;

    expect(JSON.parse(result.content).error).toMatch(/was cancelled/);
    expect(result.trace).toMatch(/cancelled/);
  });

  it('times out plugin work that ignores aborts', async () => {
    vi.useFakeTimers();

    try {
      const { tool } = makeTool({
        definition: {
          name: 'search',
          description: 'Search the index.',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
          timeoutMs: 1_000,
          execute: () => new Promise<{ content: string; trace: string }>(() => undefined),
        },
      });

      const running = tool.execute(context, { query: 'x' });
      await vi.advanceTimersByTimeAsync(1_000);
      const result = await running;

      expect(JSON.parse(result.content).error).toMatch(/timed out after 1s/);
      expect(result.trace).toMatch(/timed out/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('validates declared output schemas and result shapes', async () => {
    const outputSchema = {
      type: 'object',
      properties: { answer: { type: 'integer' } },
      required: ['answer'],
      additionalProperties: false,
    };
    const build = (content: string) =>
      makeTool({
        definition: {
          name: 'search',
          description: 'Search the index.',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
          outputSchema,
          execute: async () => ({ content, trace: 'ran' }),
        },
      }).tool;

    expect((await build('{"answer":42}').execute(context, { query: 'x' })).trace).toBe('ran');
    expect(JSON.parse((await build('not json').execute(context, { query: 'x' })).content).error).toMatch(
      /not valid JSON/
    );
    expect(
      JSON.parse((await build('{"answer":"no"}').execute(context, { query: 'x' })).content)
        .error
    ).toMatch(/output failed validation/);

    const badShape = makeTool({
      definition: {
        name: 'search',
        description: 'Search the index.',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ content: 7, trace: 'ran' } as never),
      },
    }).tool;
    expect(
      JSON.parse((await badShape.execute(context, {})).content).error
    ).toMatch(/content must be a string/);
  });
});

describe('registry tool registration', () => {
  it('registers and unregisters owned tools for a running plugin', async () => {
    const { registry, toolHost } = createHarness();
    registry.discover(builtinWithTools(), { trustLevel: 'official', source: 'builtin' });
    await registry.install('builtin.plugin');
    await registry.enable('builtin.plugin', {
      approvePermissions: ['ai.invoke', 'storage.read'],
    });

    const definition = {
      name: 'search',
      description: 'Search.',
      parameters: { type: 'object' as const, properties: { query: { type: 'string' } } },
      permissions: ['storage.read' as const],
      execute: async () => ({ content: '{"ok":true}', trace: 'done' }),
    };
    const unregister = await registry.registerTool('builtin.plugin', definition);
    const exposed = 'plugin__builtin_plugin__search';

    expect(toolHost.has(exposed)).toBe(true);
    expect(toolHost.tools.get(exposed)?.meta?.source).toBe('plugin');
    expect((await toolHost.tools.get(exposed)!.execute(context, { query: 'x' })).content).toBe(
      '{"ok":true}'
    );
    await expect(registry.registerTool('builtin.plugin', definition)).rejects.toThrow(
      /already registered tool/
    );

    unregister();
    expect(toolHost.has(exposed)).toBe(false);

    await registry.registerTool('builtin.plugin', definition);
    await registry.disable('builtin.plugin');
    expect(toolHost.has(exposed)).toBe(false);
  });

  it('rejects tool registration before ai.invoke is granted or while stopped', async () => {
    const { registry, toolHost } = createHarness();
    registry.discover(builtinWithTools(), { trustLevel: 'official', source: 'builtin' });
    await registry.install('builtin.plugin');

    const definition = {
      name: 'search',
      description: 'Search.',
      parameters: { type: 'object' as const, properties: {} },
      execute: async () => ({ content: '{}', trace: '' }),
    };

    await expect(registry.registerTool('builtin.plugin', definition)).rejects.toThrow(
      /only register tools while starting or running/
    );
    await expect(registry.enable('builtin.plugin')).rejects.toThrow(
      MissingPluginPermissionsError
    );

    await registry.enable('builtin.plugin', {
      approvePermissions: ['ai.invoke', 'storage.read'],
    });
    const unregister = await registry.registerTool('builtin.plugin', definition);
    expect(toolHost.has('plugin__builtin_plugin__search')).toBe(true);
    unregister();
  });
});
