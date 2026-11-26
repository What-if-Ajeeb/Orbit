/**
 * Security-only contract for the Android mobile sandbox.
 *
 * The sandbox never executes guest code. It validates manifests, permissions,
 * approvals, paths, URLs and request envelopes, and mediates a bounded file
 * read through the app-process Kotlin boundary. Every decision carries an audit
 * record that the host persists through the existing plugin audit table.
 */

export type SandboxPermission =
  | 'files.read'
  | 'files.write'
  | 'network.access'
  | 'sandbox.inspect';

export type SandboxOperation = 'file.read' | 'file.stat' | 'network.request';

export type SandboxManifest = {
  pluginId: string;
  version: string;
  permissions?: SandboxPermission[];
  capabilities?: string[];
  [key: string]: unknown;
};

export type SandboxApprovalEvidence = {
  permission: SandboxPermission;
  /** Exact resource (relative path or URL) this grant is valid for. */
  resource: string;
  grantedAt: number;
  expiresAt: number;
  requestId?: string;
};

export type SandboxLimits = {
  maxEnvelopeBytes: number;
  maxFileBytes: number;
  maxPathBytes: number;
  maxNetworkUrlBytes: number;
  maxRequestFields: number;
  approvalTtlSeconds: number;
};

export type SandboxAuditRecord = {
  id: string;
  at: number;
  pluginId: string;
  operation: string;
  decision: 'allow' | 'deny';
  reasonCode: string;
  permission: SandboxPermission | null;
  resourceHash: string | null;
  bytes: number;
  durationMs: number;
  policyVersion: number;
};

export type SandboxValidationReport = {
  ok: boolean;
  errors: string[];
  policyVersion: number;
  audit: SandboxAuditRecord;
};

export type SandboxPermissionCheck = {
  allowed: boolean;
  permission: SandboxPermission;
  declared: boolean;
  granted: boolean;
  approvalRequired: boolean;
  reason: string;
  reasonCode: string;
  policyVersion: number;
  audit: SandboxAuditRecord;
};

export type SandboxPathReport = {
  ok: boolean;
  normalizedPath: string | null;
  errors: string[];
  policyVersion: number;
  audit: SandboxAuditRecord;
};

export type SandboxNetworkReport = {
  ok: boolean;
  normalizedUrl: string | null;
  errors: string[];
  policyVersion: number;
  audit: SandboxAuditRecord;
};

export type SandboxRequestReport = {
  ok: boolean;
  errors: string[];
  policyVersion: number;
  audit: SandboxAuditRecord;
};

export type SandboxOperationDecision = {
  decision: 'allow' | 'deny';
  operation: string;
  permission: SandboxPermission | null;
  normalizedResource: string | null;
  reason: string;
  reasonCode: string;
  policyVersion: number;
  limits: SandboxLimits;
  audit: SandboxAuditRecord;
};

export type SandboxPolicyDescription = {
  coreVersion: string;
  policyVersion: number;
  isolation: string;
  securityCapabilities: string[];
  allowedOperations: string[];
  permissions: SandboxPermission[];
  execution: false;
  limits: SandboxLimits;
};

export type SandboxResponse<T> = {
  id: string;
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
};

export type SandboxPermissionRequest = {
  manifest: SandboxManifest;
  grantedPermissions: SandboxPermission[];
  requestedPermission: SandboxPermission;
  approval?: SandboxApprovalEvidence | null;
  now?: number;
};

export type SandboxAuthorizeRequest = {
  manifest: SandboxManifest;
  operation: SandboxOperation;
  grantedPermissions: SandboxPermission[];
  approval?: SandboxApprovalEvidence | null;
  resource: { path?: string; url?: string };
  now?: number;
};

export type SandboxFileReadRequest = {
  pluginId: string;
  manifest: SandboxManifest;
  path: string;
  grantedPermissions: SandboxPermission[];
  approval?: SandboxApprovalEvidence | null;
};

export type SandboxFileReadResult = SandboxOperationDecision & {
  path?: string | null;
  content?: string;
  bytesRead?: number;
};

export type SandboxRequestValidation = {
  method: string;
  envelopeBytes: number;
  fields?: Record<string, unknown>;
};

/** The only surface the React Native layer has to the native sandbox. */
export type SandboxTransport = {
  describe(): Promise<string>;
  validateManifest(manifestJson: string): Promise<string>;
  checkPermission(requestJson: string): Promise<string>;
  validatePath(requestJson: string): Promise<string>;
  validateNetwork(requestJson: string): Promise<string>;
  validateRequest(requestJson: string): Promise<string>;
  authorizeOperation(requestJson: string): Promise<string>;
  readFile(requestJson: string): Promise<string>;
  shutdown(): Promise<string>;
};

export type SandboxSessionStatus = 'running' | 'allowed' | 'denied' | 'failed';

export type SandboxSession = {
  id: string;
  pluginId: string;
  operation: string;
  status: SandboxSessionStatus;
  startedAt: number;
  finishedAt?: number;
  reasonCode?: string;
  audit?: SandboxAuditRecord;
};

export type SandboxSnapshot = {
  description: SandboxPolicyDescription | null;
  sessions: SandboxSession[];
  lastError: string | null;
  busy: number;
};

export class SandboxUnavailableError extends Error {
  constructor(message = 'The ORBIT mobile sandbox is only available on Android.') {
    super(message);
    this.name = 'SandboxUnavailableError';
  }
}

export class SandboxBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SandboxBridgeError';
  }
}

export class SandboxApprovalDeniedError extends Error {
  constructor() {
    super('Sandbox access was not approved.');
    this.name = 'SandboxApprovalDeniedError';
  }
}

export class SandboxOperationDeniedError extends Error {
  constructor(
    readonly reasonCode: string,
    message: string,
    readonly audit?: SandboxAuditRecord
  ) {
    super(message);
    this.name = 'SandboxOperationDeniedError';
  }
}
