import { describe, expect, it } from 'vitest';

import { classifyToolAction, fingerprintForV2 } from './classifier';
import type { AgentIdentity } from './types';

const AGENT: AgentIdentity = {
  id: 'research',
  name: 'Research Agent',
  role: 'specialist',
  description: 'Reads connected sources.',
  icon: 'search',
};

function classify(toolName: string) {
  return classifyToolAction({
    toolName,
    args: { query: 'release notes' },
    agent: AGENT,
    projectId: 'project-1',
    projectLabel: 'Orbit',
  });
}

describe('demand plugin tool classification', () => {
  it('keeps discovery read-only and auto-approved', () => {
    const action = classify('orbit_plugin_discover');

    expect(action.risk).toBe('low');
    expect(action.autoApprove).toBe(true);
    expect(action.metadata).toMatchObject({ pluginDemand: true });
  });

  it('lets the plugin approval dialog decide installation and grants', () => {
    const action = classify('orbit_plugin_request');

    expect(action.risk).toBe('medium');
    expect(action.autoApprove).toBe(true);
    expect(action.metadata).toMatchObject({ pluginDemand: true, approvalGated: true });
  });
});

describe('artifact permission classification', () => {
  it('keeps artifact append local, low-risk and auto-approved', () => {
    const action = classifyArgs('artifact_append', { id: 'art_1', content: 'more' });

    expect(action.risk).toBe('low');
    expect(action.autoApprove).toBe(true);
    expect(action.category).toBe('database_operations');
    expect(action.actions).toContain('Append content to art_1');
    expect(action.metadata).toMatchObject({ localOnly: true, noNetwork: true });
  });
});

describe('Google permission classification', () => {
  it('requires explicit approval for content reads', () => {
    const action = classify('google_gmail_read');

    expect(action.risk).toBe('medium');
    expect(action.autoApprove).toBe(false);
    expect(action.metadata).toMatchObject({ connection: 'google', sensitive: true });
  });

  it('requires explicit approval for writes', () => {
    const action = classify('google_drive_trash');

    expect(action.risk).toBe('high');
    expect(action.autoApprove).toBe(false);
  });
});

function classifyArgs(toolName: string, args: Record<string, unknown>) {
  return classifyToolAction({
    toolName,
    args,
    agent: AGENT,
    projectId: 'project-1',
    projectLabel: 'Orbit',
  });
}

describe('agent safety risk taxonomy', () => {
  it('does not promote email reads to critical', () => {
    const read = classifyArgs('google_gmail_search', { query: 'in:inbox' });
    const readEmail = classifyArgs('read_email', { id: 'message-1' });

    expect(read.risk).toBe('medium');
    expect(read.freshConfirmation).toBe(false);
    expect(readEmail.risk).not.toBe('critical');
  });

  it('always requires fresh confirmation for external sending', () => {
    const action = classifyArgs('google_gmail_send', {
      to: 'someone@example.com',
      subject: 'Hello',
      body: 'Drafted by an agent',
    });

    expect(action.risk).toBe('critical');
    expect(action.freshConfirmation).toBe(true);
    expect(action.allowAlways).toBe(false);
    expect(action.external).toBe(true);
    expect(action.reversible).toBe(false);
    expect(action.target.label).toBe('someone@example.com');
    expect(action.actions.join(' ')).toContain('Drafted by an agent');
    expect(action.consequences.join(' ')).toMatch(/leave this device/);
  });

  it('requires fresh confirmation for payments and permanent deletion', () => {
    const payment = classifyArgs('payment_send', { amount: 25, currency: 'USD', recipient: 'Shop' });
    const deletion = classifyArgs('purge_account_data', { permanent: true, id: 'account-7' });

    expect(payment.risk).toBe('critical');
    expect(payment.freshConfirmation).toBe(true);
    expect(payment.target.detail).toContain('25 USD');
    expect(deletion.risk).toBe('critical');
    expect(deletion.reversible).toBe(false);
    expect(deletion.target.label).toBe('account-7');
  });

  it('treats local hard task deletion as permanent and critical', () => {
    const action = classifyArgs('delete_task', { task_id: 42 });

    expect(action.risk).toBe('critical');
    expect(action.freshConfirmation).toBe(true);
    expect(action.allowAlways).toBe(false);
  });

  it('keeps reversible file operations scoped and narrowable', () => {
    const trash = classifyArgs('file_trash', { path: '/documents/report.md' });
    const restore = classifyArgs('file_restore', { trash_id: 'trash_1' });

    expect(trash.risk).toBe('high');
    expect(trash.reversible).toBe(true);
    expect(trash.narrowable).toBe(true);
    expect(trash.allowAlways).toBe(false);
    expect(restore.risk).toBe('medium');
    expect(restore.narrowable).toBe(true);
    expect(restore.reversible).toBe(true);
  });
});

describe('approval fingerprints', () => {
  it('keeps v1 truncation for compatibility but hashes the full input in v2', () => {
    const prefix = 'x'.repeat(8_100);
    const first = classifyArgs('file_read', { path: 'orbit/note.txt', blob: `${prefix}A` });
    const second = classifyArgs('file_read', { path: 'orbit/note.txt', blob: `${prefix}B` });

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.fingerprintV2).toMatch(/^[0-9a-f]{64}$/);
    expect(first.fingerprintV2).not.toBe(second.fingerprintV2);
  });

  it('includes the active policy version in v2', () => {
    const input = {
      toolName: 'file_read',
      args: { path: 'orbit/note.txt' },
      agent: AGENT,
      projectId: 'project-1',
      projectLabel: 'Orbit',
    };

    expect(fingerprintForV2(input, 'file_read:orbit/note.txt', 'policy-a')).not.toBe(
      fingerprintForV2(input, 'file_read:orbit/note.txt', 'policy-b')
    );
  });
});
