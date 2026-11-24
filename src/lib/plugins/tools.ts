import { toolFail, type AgentTool } from '@/lib/ai/tool-registry';

import { CancelledError, errorMessage, TimeoutError, withTimeout } from './async';
import { validateJsonSchema } from './json-schema';
import type {
  PluginPermission,
  PluginSdkToolResult,
  PluginToolDefinition,
  PluginTrustLevel,
} from './types';

export type PluginToolHost = {
  register(tool: AgentTool): void;
  unregister(name: string): boolean;
  has(name: string): boolean;
};

const LOCAL_TOOL_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,40}$/;
const MAX_EXPOSED_NAME = 64;
const DEFAULT_TOOL_TIMEOUT = 15_000;
const MAX_TOOL_TIMEOUT = 60_000;

export function isValidPluginToolName(name: string): boolean {
  return LOCAL_TOOL_NAME.test(name);
}

export function pluginToolNamespace(pluginId: string): string {
  const slug = pluginId
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32);

  return `plugin__${slug || 'unknown'}__`;
}

export function namespacedPluginToolName(
  pluginId: string,
  localName: string
): string {
  if (!isValidPluginToolName(localName)) {
    throw new Error(
      `Tool name "${localName}" must match ${LOCAL_TOOL_NAME} and be at most 40 characters.`
    );
  }

  const exposed = `${pluginToolNamespace(pluginId)}${localName}`;

  if (exposed.length > MAX_EXPOSED_NAME) {
    throw new Error(
      `Tool "${localName}" makes the exposed name longer than ${MAX_EXPOSED_NAME} characters.`
    );
  }

  return exposed;
}

export type BuildPluginToolInput = {
  pluginId: string;
  pluginName: string;
  trustLevel: PluginTrustLevel;
  definition: PluginToolDefinition;
  grantedPermissions: () => PluginPermission[];
  assertPermission: (permission: PluginPermission) => void;
  isActive: () => boolean;
  requiresApproval: (toolName: string) => Promise<boolean>;
  log: (message: string, detail?: unknown) => void;
};

function formatValidationErrors(errors: string[]): string {
  return errors.slice(0, 8).join(' ');
}

/**
 * Wraps a plugin tool with provenance, permission checks, schema validation,
 * timeouts, cancellation and approval. The agent registry never receives the
 * plugin's raw implementation.
 */
export function buildPluginAgentTool(input: BuildPluginToolInput): AgentTool {
  const exposedName = namespacedPluginToolName(
    input.pluginId,
    input.definition.name
  );
  const timeoutMs = Math.min(
    Math.max(input.definition.timeoutMs ?? DEFAULT_TOOL_TIMEOUT, 1_000),
    MAX_TOOL_TIMEOUT
  );
  const requiredPermissions = [
    'ai.invoke' as PluginPermission,
    ...(input.definition.permissions ?? []),
  ].filter((permission, index, all) => all.indexOf(permission) === index);

  return {
    meta: {
      source: 'plugin',
      pluginId: input.pluginId,
      trustLevel: input.trustLevel,
      permissions: requiredPermissions,
    },
    definition: {
      name: exposedName,
      description: `[${input.pluginName}] ${input.definition.description}`.slice(0, 900),
      parameters: input.definition.parameters,
    },
    async execute(context, args) {
      const traceLabel = `Plugin · ${input.pluginName}: ${input.definition.name}`;

      if (!input.isActive()) {
        return {
          content: toolFail(`Plugin ${input.pluginId} is not running.`),
          trace: `${traceLabel} blocked (plugin stopped)`,
        };
      }

      try {
        for (const permission of requiredPermissions) {
          input.assertPermission(permission);
        }

        const inputValidation = validateJsonSchema(
          args,
          input.definition.parameters
        );

        if (!inputValidation.ok) {
          return {
            content: toolFail(
              `Invalid arguments: ${formatValidationErrors(inputValidation.errors)}`
            ),
            trace: `${traceLabel} rejected invalid arguments`,
          };
        }

        if (input.definition.requiresApproval) {
          const approved = await input.requiresApproval(
            input.definition.name
          );

          if (!approved) {
            return {
              content: toolFail('The user denied this plugin action.'),
              trace: `${traceLabel} denied by user`,
            };
          }
        }

        const controller = new AbortController();
        const external = context.signal;

        if (external) {
          if (external.aborted) {
            throw new CancelledError(traceLabel);
          }

          external.addEventListener('abort', () => controller.abort(), {
            once: true,
          });
        }

        const result = await withTimeout(
          input.definition.execute(args, {
            signal: controller.signal,
            log: input.log,
          }),
          timeoutMs,
          traceLabel,
          controller.signal
        );

        const invalidResult = validatePluginToolResult(result);

        if (invalidResult) {
          return {
            content: toolFail(invalidResult),
            trace: `${traceLabel} returned an invalid result`,
          };
        }

        if (input.definition.outputSchema) {
          let parsed: unknown;

          try {
            parsed = JSON.parse(result.content) as unknown;
          } catch {
            return {
              content: toolFail('Plugin output was not valid JSON.'),
              trace: `${traceLabel} returned invalid JSON`,
            };
          }

          const outputValidation = validateJsonSchema(
            parsed,
            input.definition.outputSchema
          );

          if (!outputValidation.ok) {
            return {
              content: toolFail(
                `Plugin output failed validation: ${formatValidationErrors(outputValidation.errors)}`
              ),
              trace: `${traceLabel} failed output validation`,
            };
          }
        }

        return result;
      } catch (error) {
        if (error instanceof TimeoutError) {
          return {
            content: toolFail(
              `Plugin tool timed out after ${Math.round(timeoutMs / 1000)}s.`
            ),
            trace: `${traceLabel} timed out`,
          };
        }

        if (error instanceof CancelledError) {
          return {
            content: toolFail('Plugin tool was cancelled.'),
            trace: `${traceLabel} cancelled`,
          };
        }

        input.log('Plugin tool failed.', error);

        return {
          content: toolFail(`Plugin tool failed: ${errorMessage(error)}`),
          trace: `${traceLabel} failed`,
        };
      }
    },
  };
}

function validatePluginToolResult(
  result: PluginSdkToolResult | unknown
): string | null {
  if (!result || typeof result !== 'object') {
    return 'Plugin returned no result.';
  }

  const candidate = result as Partial<PluginSdkToolResult>;

  if (typeof candidate.content !== 'string') {
    return 'Plugin result content must be a string.';
  }

  if (typeof candidate.trace !== 'string') {
    return 'Plugin result trace must be a string.';
  }

  if (candidate.content.length > 200_000) {
    return 'Plugin result is too large.';
  }

  return null;
}

/**
 * Enforces ownership of names before a plugin tool reaches the agent registry.
 * A plugin can never replace a core tool or another plugin's tool.
 */
export function assertToolCanRegister(
  host: PluginToolHost,
  exposedName: string
): void {
  if (host.has(exposedName)) {
    throw new Error(`A tool named "${exposedName}" is already registered.`);
  }

  if (!exposedName.startsWith('plugin__')) {
    throw new Error('Plugin tools must use the plugin__ namespace.');
  }
}
