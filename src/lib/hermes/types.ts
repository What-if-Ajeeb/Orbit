/**
 * Read-only contracts for the Hermes-style architecture layer.
 *
 * Nothing in this module executes a capability or grants permission. These
 * types describe bounded inputs to the existing hybrid controller, which owns
 * all state transitions, risk decisions, approvals and sandbox enforcement.
 */

import type { AiProvider } from '../ai/settings';

export type HermesPromptTier =
  | 'identity'
  | 'toolsets'
  | 'skill-index'
  | 'skill-bundles'
  | 'context'
  | 'memory'
  | 'session-search'
  | 'volatile';

export type HermesPromptBundle = {
  /** Complete system message assembled from stable and frozen tiers. */
  system: string;
  /** Short, stable identifier for the frozen context snapshot. */
  snapshotId: string;
  /** Hash of the stable tiers; identical inputs produce an identical prefix. */
  fingerprint: string;
  tiers: HermesPromptTier[];
  createdAt: number;
};

export type ProviderKind = 'chat-completions' | 'gemini' | 'ollama' | 'system';

export type ProviderRoute = {
  kind: ProviderKind;
  provider: AiProvider;
  adapterId: string | null;
  baseUrl: string;
  model: string;
  configured: boolean;
  /** True for the deterministic route after a configured provider. */
  fallback: boolean;
};

export type ToolsetDescriptor = {
  id: string;
  label: string;
  tools: string[];
  available: string[];
};

export type SkillIndexEntry = {
  id: string;
  name: string;
  description: string;
  capabilities: { name: string; description: string }[];
  /** Bundles are disclosure-only; they are never registered as callable tools. */
  kind?: 'skill' | 'bundle';
  skillIds?: string[];
};

export type HermesMemoryTarget = 'agent' | 'user';

export type HermesMemoryEntry = {
  target: HermesMemoryTarget;
  key: string;
  value: string;
  updatedAt?: number;
};

/** Bounded, frozen-at-build snapshot of the two Hermes memory stores. */
export type HermesMemorySnapshot = {
  agent: HermesMemoryEntry[];
  user: HermesMemoryEntry[];
  chars: { agent: number; user: number };
  limits: { agent: number; user: number };
  omitted: { agent: number; user: number };
  fingerprint: string;
  frozenAt: number;
};

export type HermesMemoryAction = 'add' | 'patch' | 'remove';

/**
 * A staged memory mutation. It carries an exact operation fingerprint so an
 * approval cannot be replayed after the key, value, target or policy changes.
 */
export type HermesStagedWrite = {
  id: string;
  target: HermesMemoryTarget;
  action: HermesMemoryAction;
  key: string;
  value: string;
  policyVersion: string;
  fingerprint: string;
  requestedAt: number;
  status: 'pending' | 'approved' | 'denied' | 'applied' | 'expired' | 'invalidated';
};

export type HermesSessionHit = {
  conversationId: number | null;
  messageId: number;
  role: string;
  snippet: string;
  createdAt: number | null;
  score: number;
};

/** Data-only grouping of existing skill ids; never registers executable code. */
export type HermesSkillBundle = {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  version: string;
  skills: string[];
  instruction?: string;
};
