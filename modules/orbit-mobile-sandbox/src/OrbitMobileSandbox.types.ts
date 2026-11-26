export type SandboxError = {
  code: string;
  message: string;
};

export type SandboxResponse<T> = {
  id: string;
  ok: boolean;
  result?: T;
  error?: SandboxError;
};

export type SandboxPermission =
  | 'files.read'
  | 'files.write'
  | 'network.access'
  | 'sandbox.inspect';

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

export type SandboxValidationReport = {
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
