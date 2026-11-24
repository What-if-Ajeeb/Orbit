export type SandboxError = {
  code: string;
  message: string;
};

export type SandboxResponse<T> = {
  id: string;
  ok: boolean;
  result?: T;
  error?: SandboxError;
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
    maxStackItems?: number;
    maxEnvelopeBytes?: number;
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
