import type { PermissionCategory, RiskLevel } from '../permissions/types';

/** Terminal state of one recorded agent action. */
export type ActivityStatus =
  | 'running'
  | 'pending'
  | 'approved'
  | 'success'
  | 'denied'
  | 'failed'
  | 'cancelled'
  | 'stopped'
  | 'blocked'
  | 'unknown'
  | 'restored';

export type ActivityRecord = {
  id: string;
  sequence: number;
  userId: number;
  conversationId: number | null;
  agentId: string;
  agentName: string;
  toolName: string;
  action: string;
  resourceKey: string;
  resourceLabel: string;
  permissionUsed: string;
  status: ActivityStatus;
  result: string;
  error: string;
  category: PermissionCategory | null;
  risk: RiskLevel | null;
  requestId: string | null;
  grantId: string | null;
  reversible: boolean;
  external: boolean;
  createdAt: number;
  metadata: Record<string, string | number | boolean | null>;
  previousHash: string;
  hash: string;
};

export type ActivityInput = {
  id?: string;
  userId: number;
  conversationId?: number | null;
  agentId: string;
  agentName: string;
  toolName: string;
  action: string;
  resourceKey?: string;
  resourceLabel?: string;
  permissionUsed?: string;
  status: ActivityStatus;
  result?: string;
  error?: string;
  category?: PermissionCategory | null;
  risk?: RiskLevel | null;
  requestId?: string | null;
  grantId?: string | null;
  reversible?: boolean;
  external?: boolean;
  createdAt?: number;
  metadata?: Record<string, string | number | boolean | null>;
};

export type TrashItemStatus = 'trashed' | 'restored' | 'purged' | 'failed';

export type TrashItem = {
  id: string;
  userId: number;
  conversationId: number | null;
  agentId: string;
  toolName: string;
  originalPath: string;
  storedPath: string;
  kind: 'file' | 'folder';
  name: string;
  size: number;
  mimeType: string;
  metadata: Record<string, string | number | boolean | null>;
  deletedAt: number;
  expiresAt: number;
  restoredAt: number | null;
  purgedAt: number | null;
  status: TrashItemStatus;
  failureReason: string | null;
};

export type ActiveOperation = {
  id: string;
  userId: number;
  conversationId: number | null;
  agentId: string;
  agentName: string;
  toolName: string;
  status: 'running' | 'cancelling' | 'stopped' | 'completed' | 'failed' | 'unknown';
  cancellable: boolean;
  external: boolean;
  startedAt: number;
  finishedAt: number | null;
  detail: string;
};

export type StopReport = {
  /** Operations for which a cancellation signal was sent; completion is not implied. */
  stopRequested: string[];
  uncancellable: string[];
  revokedGrants: number;
  cancelledRequests: number;
  createdAt?: number;
  reason?: string;
  agentId?: string | null;
};

export type OperationStopState =
  | 'stop_requested'
  | 'external_stop_requested'
  | 'unconfirmed'
  | 'external_unconfirmed';

/** A dashboard stop never claims completion; it only reports what was signalled. */
export type OperationStopResult =
  | { handled: false; state: 'not_running'; message: string }
  | { handled: true; state: OperationStopState; message: string };

export const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
