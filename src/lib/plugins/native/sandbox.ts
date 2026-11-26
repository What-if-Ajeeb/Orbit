import { getMobileSandboxManager } from '@/lib/sandbox/manager';
import type {
  SandboxApprovalEvidence,
  SandboxManifest,
  SandboxPermission,
} from '@/lib/sandbox/types';

import { seedPluginManifest } from '../manifest-seed';
import type {
  PluginImplementation,
  PluginManifest,
} from '../types';
import {
  nativeHostTool,
  nativeOutputSchema,
  objectSchema,
  readNumber,
  readString,
} from './helpers';

export const SANDBOX_PLUGIN_ID = 'orbit.builtin.sandbox';

const SANDBOX_PERMISSIONS: readonly SandboxPermission[] = [
  'files.read',
  'files.write',
  'network.access',
  'sandbox.inspect',
];

const SANDBOX_OPERATIONS = [
  'file.read',
  'file.stat',
  'network.request',
] as const;

export const sandboxManifest: PluginManifest = seedPluginManifest({
  pluginId: SANDBOX_PLUGIN_ID,
  name: 'ORBIT Sandbox',
  version: '2.0.0',
  description:
    'Android-only security policy and permission mediation. It validates manifests, approvals, paths, URLs and request envelopes, and mediates bounded app-private file reads after Rust allows them. It never executes code and is absent on iOS and web.',
  category: 'service',
  icon: 'shield-outline',
  minimumOrbitVersion: '1.0.0',
  platformSupport: ['android'],
  entryPoint: { kind: 'builtin', moduleId: 'orbit-native-sandbox' },
  permissions: ['ai.invoke', 'sandbox.inspect'],
  capabilities: ['tools.ai'],
  dependencies: [{ pluginId: 'orbit.core.tools', version: '^1.0.0' }],
  lifecycleHooks: ['onStart', 'onStop', 'onError'],
  dataSchemaVersion: 1,
});

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    at: { type: 'number' },
    pluginId: { type: 'string' },
    operation: { type: 'string' },
    decision: { type: 'string', enum: ['allow', 'deny'] },
    reasonCode: { type: 'string' },
    permission: { type: ['string', 'null'] },
    resourceHash: { type: ['string', 'null'] },
    bytes: { type: 'number' },
    durationMs: { type: 'number' },
    policyVersion: { type: 'number' },
  },
  required: ['id', 'at', 'operation', 'decision', 'reasonCode', 'policyVersion'],
};

const LIMITS_SCHEMA = {
  type: 'object',
  properties: {
    maxEnvelopeBytes: { type: 'number' },
    maxFileBytes: { type: 'number' },
    maxPathBytes: { type: 'number' },
    maxNetworkUrlBytes: { type: 'number' },
    maxRequestFields: { type: 'number' },
    approvalTtlSeconds: { type: 'number' },
  },
};

const POLICY_OUTPUT_SCHEMA = nativeOutputSchema({
  coreVersion: { type: 'string' },
  policyVersion: { type: 'number' },
  isolation: { type: 'string' },
  securityCapabilities: { type: 'array', items: { type: 'string' } },
  allowedOperations: { type: 'array', items: { type: 'string' } },
  permissions: { type: 'array', items: { type: 'string' } },
  execution: { type: 'boolean' },
  limits: LIMITS_SCHEMA,
  sessionCount: { type: 'number' },
  busy: { type: 'number' },
});

const MANIFEST_OUTPUT_SCHEMA = nativeOutputSchema({
  validation: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      errors: { type: 'array', items: { type: 'string' } },
      policyVersion: { type: 'number' },
      audit: AUDIT_SCHEMA,
    },
    required: ['ok', 'errors', 'policyVersion', 'audit'],
  },
});

const PERMISSION_OUTPUT_SCHEMA = nativeOutputSchema({
  check: {
    type: 'object',
    properties: {
      allowed: { type: 'boolean' },
      permission: { type: 'string' },
      declared: { type: 'boolean' },
      granted: { type: 'boolean' },
      approvalRequired: { type: 'boolean' },
      reason: { type: 'string' },
      reasonCode: { type: 'string' },
      policyVersion: { type: 'number' },
      audit: AUDIT_SCHEMA,
    },
    required: ['allowed', 'permission', 'reasonCode', 'audit'],
  },
});

const PATH_OUTPUT_SCHEMA = nativeOutputSchema({
  report: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      normalizedPath: { type: ['string', 'null'] },
      errors: { type: 'array', items: { type: 'string' } },
      policyVersion: { type: 'number' },
      audit: AUDIT_SCHEMA,
    },
    required: ['ok', 'errors', 'policyVersion', 'audit'],
  },
});

const NETWORK_OUTPUT_SCHEMA = nativeOutputSchema({
  report: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      normalizedUrl: { type: ['string', 'null'] },
      errors: { type: 'array', items: { type: 'string' } },
      policyVersion: { type: 'number' },
      audit: AUDIT_SCHEMA,
    },
    required: ['ok', 'errors', 'policyVersion', 'audit'],
  },
});

const REQUEST_OUTPUT_SCHEMA = nativeOutputSchema({
  report: {
    type: 'object',
    properties: {
      ok: { type: 'boolean' },
      errors: { type: 'array', items: { type: 'string' } },
      policyVersion: { type: 'number' },
      audit: AUDIT_SCHEMA,
    },
    required: ['ok', 'errors', 'policyVersion', 'audit'],
  },
});

const DECISION_OUTPUT_SCHEMA = nativeOutputSchema({
  decision: {
    type: 'object',
    properties: {
      decision: { type: 'string', enum: ['allow', 'deny'] },
      operation: { type: 'string' },
      permission: { type: ['string', 'null'] },
      normalizedResource: { type: ['string', 'null'] },
      reason: { type: 'string' },
      reasonCode: { type: 'string' },
      policyVersion: { type: 'number' },
      limits: LIMITS_SCHEMA,
      audit: AUDIT_SCHEMA,
    },
    required: ['decision', 'operation', 'reasonCode', 'policyVersion', 'audit'],
  },
});

const APPROVAL_SCHEMA = {
  type: 'object',
  properties: {
    permission: { type: 'string', enum: [...SANDBOX_PERMISSIONS] },
    grantedAt: { type: 'number' },
    expiresAt: { type: 'number' },
    requestId: { type: 'string' },
  },
  required: ['permission', 'grantedAt', 'expiresAt'],
  additionalProperties: false,
};

function readRecord(
  args: Record<string, unknown>,
  key: string
): Record<string, unknown> {
  const value = args[key];

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${key} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function readPermission(
  args: Record<string, unknown>,
  key: string
): SandboxPermission {
  const value = readString(args, key, { required: true, maxLength: 64 })!;

  if (!(SANDBOX_PERMISSIONS as readonly string[]).includes(value)) {
    throw new Error(`${key} must be one of: ${SANDBOX_PERMISSIONS.join(', ')}.`);
  }

  return value as SandboxPermission;
}

function readPermissions(
  args: Record<string, unknown>,
  key: string
): SandboxPermission[] {
  const value = args[key];

  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error(`${key} must be an array of sandbox permissions.`);
  }

  return value.map((entry, index) => {
    if (
      typeof entry !== 'string' ||
      !(SANDBOX_PERMISSIONS as readonly string[]).includes(entry)
    ) {
      throw new Error(
        `${key}[${index}] must be one of: ${SANDBOX_PERMISSIONS.join(', ')}.`
      );
    }

    return entry as SandboxPermission;
  });
}

function readApproval(
  args: Record<string, unknown>
): SandboxApprovalEvidence | null {
  if (args.approval === undefined || args.approval === null) {
    return null;
  }

  const approval = readRecord(args, 'approval');

  return {
    permission: readPermission(approval, 'permission'),
    grantedAt: readNumber(approval, 'grantedAt', {
      required: true,
      min: 0,
    })!,
    expiresAt: readNumber(approval, 'expiresAt', {
      required: true,
      min: 0,
    })!,
    ...(typeof approval.requestId === 'string'
      ? { requestId: approval.requestId.slice(0, 120) }
      : {}),
  };
}

function readManifest(args: Record<string, unknown>): SandboxManifest {
  return readRecord(args, 'manifest') as SandboxManifest;
}

const policyTool = nativeHostTool('sandbox_policy', {
  name: 'sandbox_policy',
  description:
    'Describe the Android isolated-process security policy through the existing sandbox manager. Read-only; it does not execute a program or read a file.',
  parameters: objectSchema({}, []),
  outputSchema: POLICY_OUTPUT_SCHEMA,
  async execute() {
    const manager = getMobileSandboxManager();
    const description = await manager.initialize();

    if (
      !description ||
      description.policyVersion !== 2 ||
      !description.isolation.includes('isolated') ||
      description.execution !== false
    ) {
      throw new Error('The sandbox security policy is unavailable or unsupported.');
    }

    const snapshot = manager.getSnapshot();

    return {
      coreVersion: description.coreVersion,
      policyVersion: description.policyVersion,
      isolation: description.isolation,
      securityCapabilities: [...description.securityCapabilities],
      allowedOperations: [...description.allowedOperations],
      permissions: [...description.permissions],
      execution: description.execution,
      limits: description.limits,
      sessionCount: snapshot.sessions.length,
      busy: snapshot.busy,
    };
  },
});

const validateManifestTool = nativeHostTool('sandbox_validate_manifest', {
  name: 'sandbox_validate_manifest',
  description:
    'Validate a plugin manifest against the fixed sandbox security policy. Rejects execution-shaped fields and sandbox.execute. Read-only.',
  parameters: objectSchema({ manifest: { type: 'object' } }, ['manifest']),
  outputSchema: MANIFEST_OUTPUT_SCHEMA,
  async execute(args) {
    const validation = await getMobileSandboxManager().validateManifest(
      readManifest(args)
    );
    return { validation };
  },
});

const checkPermissionTool = nativeHostTool('sandbox_check_permission', {
  name: 'sandbox_check_permission',
  description:
    'Check whether a plugin declared and was granted a sandbox permission, and whether fresh approval evidence is valid. Read-only; it does not read a file or execute code.',
  parameters: objectSchema(
    {
      manifest: { type: 'object' },
      grantedPermissions: {
        type: 'array',
        items: { type: 'string', enum: [...SANDBOX_PERMISSIONS] },
      },
      requestedPermission: { type: 'string', enum: [...SANDBOX_PERMISSIONS] },
      approval: APPROVAL_SCHEMA,
      now: { type: 'number' },
    },
    ['manifest', 'requestedPermission']
  ),
  outputSchema: PERMISSION_OUTPUT_SCHEMA,
  async execute(args) {
    const check = await getMobileSandboxManager().checkPermission({
      manifest: readManifest(args),
      grantedPermissions: readPermissions(args, 'grantedPermissions'),
      requestedPermission: readPermission(args, 'requestedPermission'),
      approval: readApproval(args),
      ...(typeof args.now === 'number' ? { now: args.now } : {}),
    });
    return { check };
  },
});

const validatePathTool = nativeHostTool('sandbox_validate_path', {
  name: 'sandbox_validate_path',
  description:
    'Validate a relative sandbox path for traversal, encoded separators, absolute paths and length. Read-only; it does not touch the filesystem.',
  parameters: objectSchema({ path: { type: 'string' } }, ['path']),
  outputSchema: PATH_OUTPUT_SCHEMA,
  async execute(args) {
    const path = readString(args, 'path', { required: true, maxLength: 1_024 })!;
    const report = await getMobileSandboxManager().validatePath(path);
    return { report };
  },
});

const validateNetworkTool = nativeHostTool('sandbox_validate_network', {
  name: 'sandbox_validate_network',
  description:
    'Validate a URL against the sandbox network policy: HTTPS only, no credentials, no private or loopback hosts. Read-only; it performs no network request.',
  parameters: objectSchema({ url: { type: 'string' } }, ['url']),
  outputSchema: NETWORK_OUTPUT_SCHEMA,
  async execute(args) {
    const url = readString(args, 'url', { required: true, maxLength: 2_048 })!;
    const report = await getMobileSandboxManager().validateNetwork(url);
    return { report };
  },
});

const validateRequestTool = nativeHostTool('sandbox_validate_request', {
  name: 'sandbox_validate_request',
  description:
    'Validate a sandbox request envelope: method allowlist, envelope size and forbidden execution fields. Read-only.',
  parameters: objectSchema(
    {
      method: { type: 'string' },
      envelopeBytes: { type: 'number' },
      fields: { type: 'object' },
    },
    ['method', 'envelopeBytes']
  ),
  outputSchema: REQUEST_OUTPUT_SCHEMA,
  async execute(args) {
    const method = readString(args, 'method', {
      required: true,
      maxLength: 80,
    })!;
    const envelopeBytes = readNumber(args, 'envelopeBytes', {
      required: true,
      min: 0,
      max: 10_000_000,
    })!;
    const report = await getMobileSandboxManager().validateRequest({
      method,
      envelopeBytes,
      ...(args.fields !== undefined
        ? { fields: readRecord(args, 'fields') }
        : {}),
    });
    return { report };
  },
});

const authorizeOperationTool = nativeHostTool('sandbox_authorize_operation', {
  name: 'sandbox_authorize_operation',
  description:
    'Evaluate the fixed policy for file.read, file.stat or network.request and return allow or deny with an audit record. It does not perform the operation.',
  parameters: objectSchema(
    {
      manifest: { type: 'object' },
      operation: { type: 'string', enum: [...SANDBOX_OPERATIONS] },
      grantedPermissions: {
        type: 'array',
        items: { type: 'string', enum: [...SANDBOX_PERMISSIONS] },
      },
      approval: APPROVAL_SCHEMA,
      resource: { type: 'object' },
      now: { type: 'number' },
    },
    ['manifest', 'operation', 'resource']
  ),
  outputSchema: DECISION_OUTPUT_SCHEMA,
  async execute(args) {
    const operation = readString(args, 'operation', {
      required: true,
      maxLength: 40,
    })!;

    if (!(SANDBOX_OPERATIONS as readonly string[]).includes(operation)) {
      throw new Error(
        `operation must be one of: ${SANDBOX_OPERATIONS.join(', ')}.`
      );
    }

    const resource = readRecord(args, 'resource');
    const decision = await getMobileSandboxManager().authorizeOperation({
      manifest: readManifest(args),
      operation: operation as (typeof SANDBOX_OPERATIONS)[number],
      grantedPermissions: readPermissions(args, 'grantedPermissions'),
      approval: readApproval(args),
      resource: {
        ...(typeof resource.path === 'string' ? { path: resource.path } : {}),
        ...(typeof resource.url === 'string' ? { url: resource.url } : {}),
      },
      ...(typeof args.now === 'number' ? { now: args.now } : {}),
    });
    return { decision };
  },
});

export const sandboxImplementation: PluginImplementation = {
  hooks: {
    onStart() {
      console.log('[plugin:orbit.builtin.sandbox] sandbox security plugin started');
    },
    onStop() {
      console.log('[plugin:orbit.builtin.sandbox] sandbox security plugin stopped');
    },
    onError() {
      console.warn('[plugin:orbit.builtin.sandbox] sandbox security plugin reported an error');
    },
  },
  activate(sdk) {
    void sdk.tools.register(policyTool);
    void sdk.tools.register(validateManifestTool);
    void sdk.tools.register(checkPermissionTool);
    void sdk.tools.register(validatePathTool);
    void sdk.tools.register(validateNetworkTool);
    void sdk.tools.register(validateRequestTool);
    void sdk.tools.register(authorizeOperationTool);
  },
};
