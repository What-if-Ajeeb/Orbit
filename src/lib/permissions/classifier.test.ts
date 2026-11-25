import { describe, expect, it } from 'vitest';

import { classifyToolAction } from './classifier';
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

  it('requires a fresh decision for every sandbox execution', () => {
    const action = classifyArgs('sandbox.execute', { manifest: '{}' });

    expect(action.category).toBe('terminal_commands');
    expect(action.risk).toBe('high');
    expect(action.freshConfirmation).toBe(true);
    expect(action.allowAlways).toBe(false);
    expect(action.metadata).toMatchObject({ sandbox: true });
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
