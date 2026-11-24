import { describe, expect, it, vi } from 'vitest';

import { MobileSandboxManager } from '../manager';
import { EXAMPLE_SANDBOX_MANIFEST, EXAMPLE_SANDBOX_INPUT } from '../programs';
import {
  SandboxApprovalDeniedError,
  SandboxBridgeError,
  type SandboxTransport,
} from '../types';

function response<T>(id: string, result: T): string {
  return JSON.stringify({ id, ok: true, result });
}

function makeTransport(overrides: Partial<SandboxTransport> = {}): SandboxTransport {
  return {
    async describe() {
      return response('1', {
        coreVersion: '0.1.0',
        policyVersion: 1,
        isolation: 'android-isolated-process',
        executionFormat: 'deterministic-json-program',
        allowedOperations: ['add', 'return'],
        limits: { maxInstructions: 256, maxOutputBytes: 16384, maxValueBytes: 8192 },
      });
    },
    async validateManifest() {
      return response('2', { ok: true, errors: [], policyVersion: 1 });
    },
    async execute() {
      return response('3', {
        ok: true,
        outputs: { greeting: 'hello orbit', doubled: 42 },
        instructionsExecuted: 9,
        errors: [],
        policyVersion: 1,
      });
    },
    async shutdown() {
      return response('4', { shutdown: true });
    },
    ...overrides,
  };
}

describe('MobileSandboxManager', () => {
  it('validates, requests approval, then executes a data-only program', async () => {
    const transport = makeTransport();
    const validate = vi.spyOn(transport, 'validateManifest');
    const execute = vi.spyOn(transport, 'execute');
    const requestApproval = vi.fn(async () => true);
    const manager = new MobileSandboxManager({ transport, requestApproval, now: () => 1000 });

    const result = await manager.execute(EXAMPLE_SANDBOX_MANIFEST, EXAMPLE_SANDBOX_INPUT);

    expect(result.outputs).toEqual({ greeting: 'hello orbit', doubled: 42 });
    expect(validate).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledOnce();
    expect(requestApproval).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: 'orbit.example.sandbox',
        permissions: ['sandbox.execute'],
        trustLevel: 'untrusted',
      })
    );

    const session = manager.getSnapshot().sessions[0];
    expect(session.status).toBe('completed');
    expect(session.outputs).toEqual(result.outputs);

    const sent = JSON.parse(execute.mock.calls[0][0]) as {
      manifest: typeof EXAMPLE_SANDBOX_MANIFEST;
      input: typeof EXAMPLE_SANDBOX_INPUT;
    };
    expect(sent.manifest).toEqual(EXAMPLE_SANDBOX_MANIFEST);
    expect(sent.input).toEqual(EXAMPLE_SANDBOX_INPUT);
  });

  it('never calls native execute when approval is denied', async () => {
    const transport = makeTransport();
    const execute = vi.spyOn(transport, 'execute');
    const manager = new MobileSandboxManager({ transport, requestApproval: async () => false });

    await expect(
      manager.execute(EXAMPLE_SANDBOX_MANIFEST, EXAMPLE_SANDBOX_INPUT)
    ).rejects.toBeInstanceOf(SandboxApprovalDeniedError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('stops when Rust validation rejects the manifest', async () => {
    const transport = makeTransport({
      async validateManifest() {
        return response('2', {
          ok: false,
          errors: ['Instruction 0 uses disallowed op: fetch'],
          policyVersion: 1,
        });
      },
    });
    const execute = vi.spyOn(transport, 'execute');
    const requestApproval = vi.fn(async () => true);
    const manager = new MobileSandboxManager({ transport, requestApproval });

    await expect(manager.execute(EXAMPLE_SANDBOX_MANIFEST)).rejects.toBeInstanceOf(
      SandboxBridgeError
    );
    expect(requestApproval).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it('records a failed session when the native bridge rejects the call', async () => {
    const transport = makeTransport({
      async execute() {
        return JSON.stringify({
          id: '3',
          ok: false,
          result: null,
          error: { code: 'native_failure', message: 'Native core failed.' },
        });
      },
    });
    const manager = new MobileSandboxManager({
      transport,
      requestApproval: async () => true,
      now: () => 5000,
    });

    await expect(manager.execute(EXAMPLE_SANDBOX_MANIFEST)).rejects.toThrow('Native core failed.');
    expect(manager.getSnapshot().sessions[0]).toMatchObject({
      status: 'failed',
      errors: ['Native core failed.'],
      finishedAt: 5000,
    });
  });
});
