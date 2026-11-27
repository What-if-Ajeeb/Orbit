import { Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { SecureToolSandboxGate } from '../permissions/executor';
import { stableJson } from '../agent-runtime/hash';

import { getMobileSandboxManager, type MobileSandboxManager } from './manager';
import type {
  SandboxApprovalEvidence,
  SandboxAuthorizeRequest,
  SandboxManifest,
  SandboxOperation,
  SandboxPermission,
} from './types';

const RUNTIME_MANIFEST: SandboxManifest = {
  pluginId: 'orbit.runtime',
  version: '1.0.0',
  permissions: ['files.read', 'files.write', 'network.access', 'sandbox.inspect'],
  capabilities: [],
};

function relativeDocumentPath(value: string): string {
  const root = Paths.document.uri.replace(/\/+$/, '');
  if (value === root) return '';
  if (value.startsWith(`${root}/`)) return value.slice(root.length + 1);
  return value.replace(/^file:\/\//, '').replace(/^\/+/, '');
}

function pathValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function urlValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return /^https?:\/\//i.test(text) ? text : '';
}

function isSelfMediatingTool(toolName: string): boolean {
  return (
    toolName.startsWith('sandbox_') ||
    toolName === 'file_trash' ||
    toolName === 'file_restore' ||
    toolName === 'file_undo_last'
  );
}

function requestFields(args: Record<string, unknown>): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of Object.entries(args)) {
    if (value === null || value === undefined) continue;
    const type = Array.isArray(value) ? 'array' : typeof value;
    fields[key.slice(0, 40)] = type === 'object' ? 'object' : type;
  }
  return fields;
}

async function validateEnvelope(
  manager: MobileSandboxManager,
  toolName: string,
  args: Record<string, unknown>
): Promise<void> {
  const report = await manager.validateRequest({
    method: toolName,
    envelopeBytes: stableJson(args).length,
    fields: requestFields(args),
  });
  if (!report.ok) {
    throw new Error(`Sandbox rejected the request envelope: ${report.errors.join('; ')}`);
  }
}

function approvalFor(
  manifest: SandboxManifest,
  operation: SandboxOperation,
  permission: SandboxPermission,
  resource: string,
  toolName: string,
  manager: MobileSandboxManager
): Promise<SandboxApprovalEvidence> {
  return manager.requestOperationApproval({
    pluginId: manifest.pluginId,
    pluginName: 'ORBIT Agent Runtime',
    trustLevel: 'official',
    permission,
    resource,
    reason: `Allow ${toolName} to ${operation} this ${permission === 'network.access' ? 'URL' : 'path'}.`,
  });
}

async function authorizeOperation(
  manager: MobileSandboxManager,
  input: {
    operation: SandboxOperation;
    permission: SandboxPermission;
    resource: { path?: string; url?: string };
    toolName: string;
  }
): Promise<void> {
  const resource =
    input.permission === 'network.access' ? input.resource.url ?? '' : input.resource.path ?? '';

  const approval = await approvalFor(
    RUNTIME_MANIFEST,
    input.operation,
    input.permission,
    resource,
    input.toolName,
    manager
  );
  const request: SandboxAuthorizeRequest = {
    manifest: RUNTIME_MANIFEST,
    operation: input.operation,
    grantedPermissions: [input.permission],
    approval,
    resource: input.resource,
  };
  const decision = await manager.authorizeOperation(request);
  if (decision.decision !== 'allow') {
    throw new Error(`The Android sandbox denied ${input.operation}: ${decision.reason}`);
  }
}

export async function authorizeSandboxPath(options: {
  manager?: MobileSandboxManager;
  operation: SandboxOperation;
  path: string;
  toolName: string;
}): Promise<void> {
  const manager = options.manager ?? getMobileSandboxManager();
  const path = relativeDocumentPath(options.path);
  if (!path) throw new Error('A file path is required for this operation.');

  const report = await manager.validatePath(path);
  if (!report.ok || !report.normalizedPath) {
    throw new Error(`Sandbox rejected the path: ${report.errors.join('; ') || 'invalid path'}`);
  }

  await authorizeOperation(manager, {
    operation: options.operation,
    permission: options.operation === 'file.read' || options.operation === 'file.stat'
      ? 'files.read'
      : 'files.write',
    resource: { path: report.normalizedPath },
    toolName: options.toolName,
  });
}

export async function authorizeSandboxUrl(options: {
  manager?: MobileSandboxManager;
  url: string;
  toolName: string;
}): Promise<void> {
  const manager = options.manager ?? getMobileSandboxManager();
  const report = await manager.validateNetwork(options.url);
  if (!report.ok || !report.normalizedUrl) {
    throw new Error(`Sandbox rejected the URL: ${report.errors.join('; ') || 'invalid URL'}`);
  }

  await authorizeOperation(manager, {
    operation: 'network.request',
    permission: 'network.access',
    resource: { url: report.normalizedUrl },
    toolName: options.toolName,
  });
}

/**
 * Host-side sandbox gate installed on every secure tool call. Sandbox-native
 * tools already mediate themselves and are skipped. Sensitive operations with
 * no native equivalent are still sent through Rust request validation; when a
 * concrete path or URL is available, Rust authorization and fresh resource-bound
 * approval are required before the tool body runs.
 */
export function createSandboxGate(options: {
  enabled?: boolean;
  manager?: MobileSandboxManager;
} = {}): SecureToolSandboxGate {
  const enabled = options.enabled ?? Platform.OS === 'android';

  return async (input) => {
    if (!enabled || isSelfMediatingTool(input.toolName)) return;
    const manager = options.manager ?? getMobileSandboxManager();

    await validateEnvelope(manager, input.toolName, input.args);

    if (input.toolName === 'computer_execute') {
      // Command execution belongs to the paired companion and its own approval
      // boundary. The envelope still passes through the Rust sandbox core.
      return;
    }

    const url =
      urlValue(input.args.url) ||
      urlValue(input.args.uri) ||
      urlValue(input.args.endpoint) ||
      urlValue(input.args.href);
    if (url) {
      await authorizeSandboxUrl({ manager, url, toolName: input.toolName });
    }

    const rawPath =
      pathValue(input.args.path) ||
      pathValue(input.args.file_path) ||
      pathValue(input.args.filePath) ||
      pathValue(input.args.uri);

    if (rawPath && !url) {
      const operation: SandboxOperation = /read|list|stat|inspect/i.test(input.toolName)
        ? 'file.read'
        : 'file.write';
      await authorizeSandboxPath({ manager, path: rawPath, operation, toolName: input.toolName });
    } else if (/^mcp__|search_web|web_search/i.test(input.toolName)) {
      // The MCP fetch adapter mediates the concrete URL immediately before the
      // request. The tool envelope is validated here so every call is audited.
      return;
    }
  };
}

export const sandboxGate = createSandboxGate();
