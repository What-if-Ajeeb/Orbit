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
  | 'context'
  | 'memory'
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
};
