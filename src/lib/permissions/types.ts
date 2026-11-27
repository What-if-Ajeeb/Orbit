import type { PolicyDecision } from '../policy';
import type { ActivityRecord, ActiveOperation, StopReport } from '../safety/types';

/**
 * Every protected capability Orbit can ask the user to authorize. Categories
 * are deliberately broad: a grant is always narrowed further by agent, tool,
 * project and scope key before it can be reused.
 */
export const PERMISSION_CATEGORIES = [
  'computer_access',
  'terminal_commands',
  'file_read',
  'file_write',
  'file_delete',
  'browser_automation',
  'website_access',
  'app_installation',
  'camera_microphone',
  'location',
  'contacts',
  'external_api',
  'database_operations',
  'network_access',
  'background_automation',
] as const;

export type PermissionCategory = (typeof PERMISSION_CATEGORIES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high', 'critical'] as const;
export type RiskLevel = (typeof RISK_LEVELS)[number];

/** `session` grants live only in the current app run and expire with it. */
export type PermissionGrantScope = 'once' | 'session' | 'persistent';
export type PermissionDecisionOption =
  | 'allow_once'
  | 'allow_session'
  | 'always_allow'
  | 'never_allow'
  | 'ask_every_time'
  | 'deny';

export type AgentRole = 'master' | 'specialist' | 'dynamic';

export type AgentIdentity = {
  id: string;
  name: string;
  role: AgentRole;
  description: string;
  /** Ionicons glyph name. Kept as a string so the service has no UI dependency. */
  icon: string;
};

export type PermissionTargetKind =
  | 'device'
  | 'application'
  | 'file'
  | 'service'
  | 'website'
  | 'resource'
  | 'agent';

export type PermissionTarget = {
  kind: PermissionTargetKind;
  label: string;
  detail?: string;
};

export type PermissionRequestStatus =
  | 'pending'
  | 'auto_approved'
  | 'approved_once'
  | 'approved_session'
  | 'approved_always'
  | 'denied'
  | 'cancelled'
  | 'expired'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'blocked';

export type PermissionResolution =
  | 'allow_once'
  | 'allow_session'
  | 'always_allow'
  | 'never_allow'
  | 'ask_every_time'
  | 'deny'
  | 'cancel'
  | 'auto_grant'
  | 'existing_grant'
  | 'agent_stopped'
  | 'emergency_stop';

export type PermissionAuditEvent =
  | 'request_created'
  | 'request_auto_approved'
  | 'approved_once'
  | 'approved_session'
  | 'approved_always'
  | 'never_allowed'
  | 'ask_every_time'
  | 'denied'
  | 'cancelled'
  | 'expired'
  | 'grant_revoked'
  | 'grant_consumed'
  | 'execution_authorized'
  | 'execution_completed'
  | 'execution_failed'
  | 'execution_blocked'
  | 'agent_stopped'
  | 'agent_resumed'
  | 'emergency_stop'
  | 'emergency_resume'
  | 'device_paired'
  | 'device_revoked'
  | 'android_permission_denied'
  | 'agent_created';

export type PermissionRequestRecord = {
  id: string;
  userId: number;
  agentId: string;
  agentName: string;
  agentRole: AgentRole;
  category: PermissionCategory;
  risk: RiskLevel;
  toolName: string;
  projectId: string;
  projectLabel: string;
  conversationId: number | null;
  title: string;
  summary: string;
  actions: string[];
  target: PermissionTarget;
  reason: string;
  commandPreview: string | null;
  scopeKey: string;
  resourceKey: string;
  fingerprint: string;
  fingerprintV2?: string;
  freshConfirmation: boolean;
  reversible: boolean;
  external: boolean;
  allowAlways: boolean;
  status: PermissionRequestStatus;
  resolution: PermissionResolution | null;
  createdAt: number;
  expiresAt: number;
  resolvedAt: number | null;
  metadata: Record<string, string | number | boolean | null>;
};

export type PermissionGrantRecord = {
  id: string;
  userId: number;
  requestId: string | null;
  agentId: string;
  agentName: string;
  toolName: string;
  category: PermissionCategory;
  scopeKey: string;
  resourceKey: string;
  fingerprint: string;
  fingerprintV2?: string;
  projectId: string;
  projectLabel: string;
  scope: PermissionGrantScope;
  sessionId: string;
  choice: 'one_time' | 'allow_session' | 'always_allow';
  narrow: boolean;
  risk: RiskLevel;
  title: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  useCount: number;
  maxUses: number | null;
  revokedAt: number | null;
  status: 'active' | 'consumed' | 'expired' | 'revoked';
};

export type PermissionDenialRecord = {
  id: string;
  userId: number;
  agentId: string;
  toolName: string;
  category: PermissionCategory;
  projectId: string;
  scopeKey: string;
  resourceKey: string;
  reason: 'never_allow';
  createdAt: number;
  revokedAt: number | null;
};

export type PermissionPreferenceRecord = {
  userId: number;
  agentId: string;
  toolName: string;
  category: PermissionCategory;
  projectId: string;
  scopeKey: string;
  resourceKey: string;
  choice: 'ask_every_time';
  createdAt: number;
  updatedAt: number;
  revokedAt: number | null;
};

export type PermissionAuditRecord = {
  id: number;
  userId: number;
  requestId: string | null;
  grantId: string | null;
  agentId: string | null;
  event: PermissionAuditEvent;
  category: PermissionCategory | null;
  risk: RiskLevel | null;
  toolName: string | null;
  projectId: string | null;
  detail: string;
  createdAt: number;
};

export type PermissionAuthorization = {
  id: string;
  requestId: string;
  grantId: string | null;
  userId: number;
  agentId: string;
  agentName: string;
  toolName: string;
  category: PermissionCategory;
  risk: RiskLevel;
  scopeKey: string;
  resourceKey: string;
  fingerprint: string;
  fingerprintV2?: string;
  projectId: string;
  conversationId: number | null;
  freshConfirmation: boolean;
  reversible: boolean;
  external: boolean;
  action: string;
  once: boolean;
  issuedAt: number;
  expiresAt: number;
};

export type PermissionDenialReason =
  | 'user_denied'
  | 'user_cancelled'
  | 'expired'
  | 'emergency_stop'
  | 'policy_denied'
  | 'invalid_request'
  | 'authorization_invalid'
  | 'authorization_expired'
  | 'authorization_consumed'
  | 'grant_revoked'
  | 'never_allowed'
  | 'ask_every_time'
  | 'agent_stopped'
  | 'risk_escalated'
  | 'fingerprint_mismatch'
  | 'scope_mismatch'
  | 'android_permission_denied'
  | 'command_blocked'
  | 'sandbox_denied'
  | 'execution_timeout'
  | 'execution_failed';

export type PermissionOutcome =
  | {
      allowed: true;
      authorization: PermissionAuthorization;
      request: PermissionRequestRecord;
      via: 'existing_grant' | 'allow_once' | 'allow_session' | 'always_allow' | 'auto';
    }
  | {
      allowed: false;
      reason: PermissionDenialReason;
      message: string;
      request?: PermissionRequestRecord;
    };

/**
 * A classified action is produced before a request exists. It carries only
 * redacted, display-ready strings; raw arguments never enter SQLite.
 */
export type ClassifiedPermissionAction = {
  agent: AgentIdentity;
  category: PermissionCategory;
  risk: RiskLevel;
  toolName: string;
  title: string;
  summary: string;
  actions: string[];
  target: PermissionTarget;
  reason: string;
  commandPreview: string | null;
  projectId: string;
  projectLabel: string;
  scopeKey: string;
  resourceKey: string;
  fingerprint: string;
  fingerprintV2?: string;
  narrowable: boolean;
  freshConfirmation: boolean;
  reversible: boolean;
  external: boolean;
  cancellable: boolean;
  consequences: string[];
  allowAlways: boolean;
  autoApprove: boolean;
  metadata: Record<string, string | number | boolean | null>;
};

export type ToolPermissionRequest = {
  userId: number;
  conversationId?: number | null;
  action: ClassifiedPermissionAction;
  policy: {
    decision: PolicyDecision;
    ruleId: string | null;
    reason?: string;
  };
};

export type PermissionState = {
  queue: PermissionRequestRecord[];
  emergencyStop: boolean;
  emergencyStopReason: string | null;
  stoppedAgents: string[];
  sessionId: string;
  activityRevision: number;
  lastStopReport: StopReport | null;
  loading: boolean;
  revision: number;
};

export type PairedDeviceRecord = {
  id: string;
  userId: number;
  name: string;
  platform: string;
  endpoint: string;
  fingerprint: string;
  status: 'paired' | 'offline' | 'revoked';
  capabilities: string[];
  pairedAt: number;
  lastSeenAt: number | null;
};

export type PermissionDashboardData = {
  grants: PermissionGrantRecord[];
  requests: PermissionRequestRecord[];
  audit: PermissionAuditRecord[];
  devices: PairedDeviceRecord[];
  dynamicAgents: AgentIdentity[];
  denials: PermissionDenialRecord[];
  preferences: PermissionPreferenceRecord[];
  activeOperations: ActiveOperation[];
  activity: ActivityRecord[];
  emergencyStop: boolean;
  emergencyStopReason: string | null;
  stoppedAgents: string[];
  sessionId: string;
  pending: PermissionRequestRecord[];
};

export type AndroidPermissionState =
  | 'not_required'
  | 'granted'
  | 'denied'
  | 'unavailable';
