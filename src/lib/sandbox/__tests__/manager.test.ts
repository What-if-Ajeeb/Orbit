import { describe, expect, it, vi } from 'vitest';

import { MobileSandboxManager } from '../manager';
import {
  SandboxApprovalDeniedError,
  SandboxBridgeError,
  SandboxOperationDeniedError,
  type SandboxTransport,
} from '../types';

function response<T>(id: string, result: T): string {
  return JSON.stringify({ id, ok: true, result });
}

const audit = {
  id: 'audit-1',
  at: 1,
  pluginId: 'local.reader',
  operation: 'file.read',
  decision: 'allow',
  reasonCode: 'allowed',
  permission: 'files.read',
  resourceHash: 'abc',
  bytes: 2,
  durationMs: 1,
  policyVersion: 2,
};

const description = {
  coreVersion: '0.2.0',
  policyVersion: 2,
  isolation: 'android-isolated-process',
  securityCapabilities: ['manifest-validation'],
  allowedOperations: ['file.read', 'file.stat', 'network.request'],
  permissions: ['files.read', 'sandbox.inspect'],
  execution: false as const,
  limits: {
    maxEnvelopeBytes: 65536,
    maxFileBytes: 262144,
    maxPathBytes: 1024,
    maxNetworkUrlBytes: 2048,
    maxRequestFields: 32,
    approvalTtlSeconds: 300,
  },
};

function makeTransport(overrides: Partial<SandboxTransport> = {}): SandboxTransport {
  return {
    async describe() {
      return response('1', description);
    },
    async validateManifest() {
      return response('2', {
        ok: true,
        errors: [],
        policyVersion: 2,
        audit,
      });
    },
    async checkPermission() {
      return response('3', {
        allowed: true,
        permission: 'files.read',
        declared: true,
        granted: true,
        approvalRequired: true,
        reason: 'files.read is declared, granted and approved.',
        reasonCode: 'allowed',
        policyVersion: 2,
        audit,
      });
    },
    async validatePath() {
      return response('4', {
        ok: true,
        normalizedPath: 'orbit/note.txt',
        errors: [],
        policyVersion: 2,
        audit,
      });
    },
    async validateNetwork() {
      return response('5', {
        ok: true,
        normalizedUrl: 'https://example.com',
        errors: [],
        policyVersion: 2,
        audit,
      });
    },
    async validateRequest() {
      return response('6', { ok: true, errors: [], policyVersion: 2, audit });
    },
    async authorizeOperation() {
      return response('7', {
        decision: 'allow',
        operation: 'file.read',
        permission: 'files.read',
        normalizedResource: 'orbit/note.txt',
        reason: 'Policy allowed the operation.',
        reasonCode: 'allowed',
        policyVersion: 2,
        limits: description.limits,
        audit,
      });
    },
    async readFile() {
      return response('8', {
        decision: 'allow',
        operation: 'file.read',
        permission: 'files.read',
        normalizedResource: 'orbit/note.txt',
        path: 'orbit/note.txt',
        content: 'hello',
        bytesRead: 5,
        reason: 'Policy allowed the read.',
        reasonCode: 'allowed',
        policyVersion: 2,
        limits: description.limits,
        audit,
      });
    },
    async shutdown() {
      return response('9', { shutdown: true });
    },
    ...overrides,
  };
}

const manifest = {
  pluginId: 'local.reader',
  version: '1.0.0',
  permissions: ['files.read' as const, 'sandbox.inspect' as const],
};

describe('MobileSandboxManager', () => {
  it('describes a security-only policy', async () => {
    const manager = new MobileSandboxManager({ transport: makeTransport() });
    const result = await manager.initialize();

    expect(result.execution).toBe(false);
    expect(result.allowedOperations).toContain('file.read');
    expect(result.allowedOperations).not.toContain('push');
  });

  it('emits audit records for validation decisions', async () => {
    const transport = makeTransport();
    const manager = new MobileSandboxManager({ transport });
    const onAudit = vi.fn();
    manager.onAudit(onAudit);

    await manager.validateManifest(manifest);
    await manager.validatePath('orbit/note.txt');

    expect(onAudit).toHaveBeenCalledTimes(2);
    expect(onAudit).toHaveBeenCalledWith(audit);
  });

  it('requests fresh approval evidence before a mediated read', async () => {
    const transport = makeTransport();
    const readFile = vi.spyOn(transport, 'readFile');
    const requestApproval = vi.fn(async () => true);
    const manager = new MobileSandboxManager({
      transport,
      requestApproval,
      now: () => 1_000,
    });
    await manager.initialize();

    const approval = await manager.requestOperationApproval({
      pluginId: 'local.reader',
      trustLevel: 'local',
      permission: 'files.read',
      resource: 'orbit/note.txt',
      reason: 'Read a note.',
    });
    expect(approval).toEqual({
      permission: 'files.read',
      resource: 'orbit/note.txt',
      grantedAt: 1_000,
      expiresAt: 301_000,
      requestId: 'sandbox-approval-1000',
    });

    const result = await manager.readFile({
      pluginId: 'local.reader',
      manifest,
      path: 'orbit/note.txt',
      grantedPermissions: ['files.read'],
      approval,
    });

    expect(result.content).toBe('hello');
    expect(readFile).toHaveBeenCalledOnce();
    expect(JSON.parse(readFile.mock.calls[0][0])).toMatchObject({
      pluginId: 'local.reader',
      path: 'orbit/note.txt',
      approval,
    });
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'local.reader',
        permissions: ['files.read'],
        trustLevel: 'local',
        reason: expect.stringContaining('Target: orbit/note.txt'),
      })
    );

    const session = manager.getSnapshot().sessions[0];
    expect(session.status).toBe('allowed');
    expect(session.operation).toBe('file.read');
  });

  it('never calls native readFile when approval is denied', async () => {
    const transport = makeTransport();
    const readFile = vi.spyOn(transport, 'readFile');
    const manager = new MobileSandboxManager({
      transport,
      requestApproval: async () => false,
    });

    await expect(
      manager.requestOperationApproval({
        pluginId: 'local.reader',
        trustLevel: 'local',
        permission: 'files.read',
        resource: 'orbit/note.txt',
        reason: 'Read a note.',
      })
    ).rejects.toBeInstanceOf(SandboxApprovalDeniedError);
    expect(readFile).not.toHaveBeenCalled();
  });

  it('throws a structured error when Rust denies an operation', async () => {
    const transport = makeTransport({
      async readFile() {
        return response('8', {
          decision: 'deny',
          operation: 'file.read',
          permission: 'files.read',
          normalizedResource: null,
          reason: 'A fresh user approval is required for files.read.',
          reasonCode: 'approval_required',
          policyVersion: 2,
          limits: description.limits,
          audit: { ...audit, decision: 'deny', reasonCode: 'approval_required' },
        });
      },
    });
    const manager = new MobileSandboxManager({ transport });

    await expect(
      manager.readFile({
        pluginId: 'local.reader',
        manifest,
        path: 'orbit/note.txt',
        grantedPermissions: ['files.read'],
      })
    ).rejects.toBeInstanceOf(SandboxOperationDeniedError);
  });

  it('records a failed session when the native bridge rejects the call', async () => {
    const transport = makeTransport({
      async authorizeOperation() {
        return JSON.stringify({
          id: '7',
          ok: false,
          result: null,
          error: { code: 'native_failure', message: 'Native core failed.' },
        });
      },
    });
    const manager = new MobileSandboxManager({
      transport,
      now: () => 5000,
    });

    await expect(
      manager.authorizeOperation({
        manifest,
        operation: 'file.read',
        grantedPermissions: ['files.read'],
        resource: { path: 'orbit/note.txt' },
      })
    ).rejects.toBeInstanceOf(SandboxBridgeError);
    expect(manager.getSnapshot().sessions[0]).toMatchObject({
      status: 'failed',
      reasonCode: 'bridge_failure',
      finishedAt: 5000,
    });
  });
});
