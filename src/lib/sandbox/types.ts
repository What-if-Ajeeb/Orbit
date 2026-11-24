export type SandboxInstruction =
  | { op: 'push'; value: string | number | boolean | null }
  | { op: 'load'; key: 'input'; field?: string }
  | { op: 'emit'; key: string }
  | { op: 'add' | 'sub' | 'mul' | 'concat' | 'return' };

export type SandboxProgramManifest = {
  pluginId: string;
  version: string;
  program: {
    version: 1;
    instructions: SandboxInstruction[];
  };
};

export type SandboxValidationReport = {
  ok: boolean;
  errors: string[];
  policyVersion: number;
};

export type SandboxExecutionResult = {
  ok: boolean;
  outputs: Record<string, unknown>;
  instructionsExecuted: number;
  errors: string[];
  policyVersion: number;
};

export type SandboxPolicyDescription = {
  coreVersion: string;
  policyVersion: number;
  isolation: string;
  executionFormat: string;
  allowedOperations: string[];
  limits: {
    maxInstructions: number;
    maxOutputBytes: number;
    maxValueBytes: number;
  };
};

export type SandboxResponse<T> = {
  id: string;
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
};

/** The only surface the React Native layer has to the native sandbox. */
export type SandboxTransport = {
  describe(): Promise<string>;
  validateManifest(manifestJson: string): Promise<string>;
  execute(requestJson: string): Promise<string>;
  shutdown(): Promise<string>;
};

export type SandboxSessionStatus = 'running' | 'completed' | 'rejected' | 'failed';

export type SandboxSession = {
  id: string;
  pluginId: string;
  version: string;
  status: SandboxSessionStatus;
  startedAt: number;
  finishedAt?: number;
  instructionsExecuted?: number;
  outputs?: Record<string, unknown>;
  errors?: string[];
};

export type SandboxSnapshot = {
  description: SandboxPolicyDescription | null;
  sessions: SandboxSession[];
  lastError: string | null;
  busy: number;
};

export class SandboxUnavailableError extends Error {
  constructor(message = 'The ORBIT mobile sandbox is only available on Android.') {
    super(message);
    this.name = 'SandboxUnavailableError';
  }
}

export class SandboxBridgeError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'SandboxBridgeError';
  }
}

export class SandboxApprovalDeniedError extends Error {
  constructor() {
    super('Sandbox execution was not approved.');
    this.name = 'SandboxApprovalDeniedError';
  }
}
