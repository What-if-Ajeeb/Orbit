import { NativeModule, requireNativeModule } from 'expo';

declare class OrbitMobileSandboxModule extends NativeModule<{}> {
  describe(): Promise<string>;
  validateManifest(manifestJson: string): Promise<string>;
  checkPermission(requestJson: string): Promise<string>;
  validatePath(requestJson: string): Promise<string>;
  validateNetwork(requestJson: string): Promise<string>;
  validateRequest(requestJson: string): Promise<string>;
  authorizeOperation(requestJson: string): Promise<string>;
  readFile(requestJson: string): Promise<string>;
  shutdown(): Promise<string>;
}

function unavailableResponse(requestJson?: string): string {
  let id = '';
  try {
    if (requestJson) {
      const parsed = JSON.parse(requestJson) as { id?: unknown };
      if (typeof parsed?.id === 'string') id = parsed.id;
    }
  } catch {
    // Ignore malformed request bodies; still return a structured failure.
  }

  return JSON.stringify({
    id,
    ok: false,
    result: null,
    error: {
      code: 'native_core_unavailable',
      message: 'OrbitMobileSandbox native module is not available in this build.',
    },
  });
}

function createUnavailableStub(): OrbitMobileSandboxModule {
  const stub = {
    describe: async () => unavailableResponse(),
    validateManifest: async (manifestJson: string) => unavailableResponse(manifestJson),
    checkPermission: async (requestJson: string) => unavailableResponse(requestJson),
    validatePath: async (requestJson: string) => unavailableResponse(requestJson),
    validateNetwork: async (requestJson: string) => unavailableResponse(requestJson),
    validateRequest: async (requestJson: string) => unavailableResponse(requestJson),
    authorizeOperation: async (requestJson: string) => unavailableResponse(requestJson),
    readFile: async (requestJson: string) => unavailableResponse(requestJson),
    shutdown: async () => unavailableResponse(),
  };

  return stub as unknown as OrbitMobileSandboxModule;
}

let moduleInstance: OrbitMobileSandboxModule;

try {
  moduleInstance = requireNativeModule<OrbitMobileSandboxModule>('OrbitMobileSandbox');
} catch (error) {
  console.warn('OrbitMobileSandbox native module is unavailable; using soft-fail stub.', error);
  moduleInstance = createUnavailableStub();
}

export default moduleInstance;
