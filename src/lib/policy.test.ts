import type { ToolPolicyRule } from './policy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  policyEngine,
  reloadPolicyRules,
  waitForPolicyHydration,
  waitForPolicyWrites,
} from './policy';

const mocks = vi.hoisted(() => {
  const store = new Map<string, string>();

  return {
    store,
    getItemAsync: vi.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: vi.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
  };
});

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-secure-store', () => mocks);

const POLICY_KEY = 'orbit.policy.rules.v1';

function persistedRules(): ToolPolicyRule[] {
  const raw = mocks.store.get(POLICY_KEY);
  return raw ? (JSON.parse(raw) as ToolPolicyRule[]) : [];
}

describe('policy engine persistence', () => {
  beforeEach(async () => {
    policyEngine.restoreDefaults();
    await waitForPolicyWrites();
    mocks.store.clear();
    mocks.getItemAsync.mockClear();
    mocks.setItemAsync.mockClear();
    await waitForPolicyHydration();
  });

  it('awaits SecureStore reads, keeps saved decisions, and adds new default rules', async () => {
    mocks.store.set(
      POLICY_KEY,
      JSON.stringify([
        {
          id: 'policy.task.create',
          name: 'Create task',
          description: 'Saved by the user.',
          match: 'exact',
          pattern: 'create_task',
          decision: 'deny',
          enabled: true,
          sandbox: {},
        },
      ])
    );

    await reloadPolicyRules();

    expect(mocks.getItemAsync).toHaveBeenCalledWith(POLICY_KEY);
    expect(policyEngine.getRule('policy.task.create')?.decision).toBe('deny');
    expect(policyEngine.getRule('policy.google.google_gmail_read')?.decision).toBe('ask');

    policyEngine.setRuleEnabled('policy.task.create', false);

    await vi.waitFor(() => {
      expect(persistedRules().find((rule) => rule.id === 'policy.task.create')?.enabled).toBe(false);
    });
    expect(persistedRules().find((rule) => rule.id === 'policy.task.create')?.decision).toBe('deny');
  });

  it('does not fall back to defaults until an explicit restore', async () => {
    mocks.store.set(
      POLICY_KEY,
      JSON.stringify([
        {
          id: 'policy.task.create',
          name: 'Create task',
          description: '',
          match: 'exact',
          pattern: 'create_task',
          decision: 'deny',
          enabled: true,
          sandbox: {},
        },
      ])
    );

    await reloadPolicyRules();
    policyEngine.restoreDefaults();

    await vi.waitFor(() => {
      expect(policyEngine.getRule('policy.task.create')?.decision).toBe('allow');
    });
    expect(mocks.setItemAsync).toHaveBeenCalled();
  });

  it('defaults invalid stored decisions to ask', async () => {
    mocks.store.set(
      POLICY_KEY,
      JSON.stringify([
        {
          id: 'policy.task.create',
          name: 'Create task',
          description: '',
          match: 'exact',
          pattern: 'create_task',
          decision: 'corrupted',
          enabled: true,
          sandbox: {},
        },
      ])
    );

    await reloadPolicyRules();

    expect(policyEngine.getRule('policy.task.create')?.decision).toBe('ask');
  });

  it('keeps deleted default rules deleted after reloading', async () => {
    await reloadPolicyRules();
    policyEngine.deleteRule('policy.task.create');
    await waitForPolicyWrites();

    expect(policyEngine.getRule('policy.task.create')).toBeNull();

    mocks.store.delete(POLICY_KEY);
    await reloadPolicyRules();

    expect(policyEngine.getRule('policy.task.create')).toBeNull();
  });

  it('derives a stable execution policy version from the active rules', () => {
    const evaluated = policyEngine.evaluate('create_task', {});
    const first = policyEngine.evaluatePolicyForExecution('create_task', {});
    const second = policyEngine.evaluatePolicyForExecution('create_task', {});

    expect(first).toMatchObject({
      decision: evaluated.decision,
      ruleId: evaluated.ruleId,
      sandbox: evaluated.sandbox,
    });
    expect(first.policyVersion).toMatch(/^[0-9a-f]{64}$/);
    expect(second.policyVersion).toBe(first.policyVersion);

    policyEngine.updateRule('policy.task.create', { sandbox: { allowNetwork: false } });
    expect(policyEngine.evaluatePolicyForExecution('create_task', {}).policyVersion).not.toBe(
      first.policyVersion
    );
  });
});
