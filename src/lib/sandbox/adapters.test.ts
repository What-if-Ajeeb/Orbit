import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSandboxGate } from './adapters';

const { DOCUMENT_ROOT, manager } = vi.hoisted(() => ({
  DOCUMENT_ROOT: 'file:///data/user/0/com.orbit.app/files/document',
  manager: {
    validateRequest: vi.fn(async () => ({ ok: true, errors: [] })),
    validatePath: vi.fn(
      async (path: string): Promise<{ ok: boolean; errors: string[]; normalizedPath: string }> => ({
        ok: true,
        errors: [],
        normalizedPath: path,
      })
    ),
    validateNetwork: vi.fn(
      async (url: string): Promise<{ ok: boolean; errors: string[]; normalizedUrl: string }> => ({
        ok: true,
        errors: [],
        normalizedUrl: url,
      })
    ),
    requestOperationApproval: vi.fn(async () => ({ id: 'approval-1' })),
    authorizeOperation: vi.fn(async (_request: unknown) => ({ decision: 'allow', reason: 'allowed' })),
  },
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => ({
  Paths: { document: { uri: DOCUMENT_ROOT } },
}));
vi.mock('./manager', () => ({ getMobileSandboxManager: () => manager }));

const gateInput = {
  toolName: 'file_write',
  args: {},
  agent: { id: 'master', name: 'Master', description: '' } as never,
  projectId: 'orbit-workspace',
  projectLabel: 'Orbit workspace',
};

type AuthorizationCall = {
  grantedPermissions: string[];
  resource?: { path?: string; url?: string };
  approval?: { id: string };
};

function lastAuthorization(): AuthorizationCall | undefined {
  return manager.authorizeOperation.mock.calls[0]?.[0] as AuthorizationCall | undefined;
}

describe('host-side sandbox gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    manager.validateRequest.mockResolvedValue({ ok: true, errors: [] });
    manager.validatePath.mockImplementation(async (path: string) => ({
      ok: true,
      errors: [],
      normalizedPath: path,
    }));
    manager.validateNetwork.mockImplementation(async (url: string) => ({
      ok: true,
      errors: [],
      normalizedUrl: url,
    }));
    manager.requestOperationApproval.mockResolvedValue({ id: 'approval-1' });
    manager.authorizeOperation.mockResolvedValue({ decision: 'allow', reason: 'allowed' });
  });

  it('skips tools that already mediate themselves in the sandbox process', async () => {
    await createSandboxGate({ enabled: true })({
      ...gateInput,
      toolName: 'sandbox_read_file',
      args: { path: '../secret' },
    });

    expect(manager.validateRequest).not.toHaveBeenCalled();
    expect(manager.authorizeOperation).not.toHaveBeenCalled();
  });

  it('requires path validation and resource-bound approval for file writes', async () => {
    await createSandboxGate({ enabled: true })({
      ...gateInput,
      args: { path: `${DOCUMENT_ROOT}/notes.txt` },
    });

    expect(manager.validateRequest).toHaveBeenCalledOnce();
    expect(manager.validatePath).toHaveBeenCalledWith('notes.txt');
    const request = lastAuthorization();
    expect(request?.grantedPermissions).toEqual(['files.write']);
    expect(request?.resource).toEqual({ path: 'notes.txt' });
    expect(request?.approval).toEqual({ id: 'approval-1' });
  });

  it('denies a file path rejected by the Rust validator', async () => {
    manager.validatePath.mockResolvedValue({
      ok: false,
      errors: ['outside app documents'],
      normalizedPath: '',
    });

    await expect(
      createSandboxGate({ enabled: true })({
        ...gateInput,
        args: { path: '../../secret' },
      })
    ).rejects.toThrow(/outside app documents/);

    expect(manager.authorizeOperation).not.toHaveBeenCalled();
  });

  it('validates MCP URLs but leaves transport mediation to the fetch adapter', async () => {
    await createSandboxGate({ enabled: true })({
      ...gateInput,
      toolName: 'mcp__search',
      args: { url: 'https://example.com/search?q=expo' },
    });

    expect(manager.validateNetwork).toHaveBeenCalledWith('https://example.com/search?q=expo');
    expect(lastAuthorization()?.grantedPermissions).toEqual(['network.access']);
  });

  it('still validates command envelopes without pretending to execute them', async () => {
    await createSandboxGate({ enabled: true })({
      ...gateInput,
      toolName: 'computer_execute',
      args: { command: 'echo hello' },
    });

    expect(manager.validateRequest).toHaveBeenCalledOnce();
    expect(manager.authorizeOperation).not.toHaveBeenCalled();
  });
});
