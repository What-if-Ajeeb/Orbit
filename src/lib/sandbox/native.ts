import {
  SandboxUnavailableError,
  type SandboxTransport,
} from './types';

function unavailable(): never {
  throw new SandboxUnavailableError();
}

/** Non-Android fallback. The native module is never loaded on these platforms. */
const transport: SandboxTransport = {
  async describe(): Promise<string> {
    return unavailable();
  },
  async validateManifest(): Promise<string> {
    return unavailable();
  },
  async checkPermission(): Promise<string> {
    return unavailable();
  },
  async validatePath(): Promise<string> {
    return unavailable();
  },
  async validateNetwork(): Promise<string> {
    return unavailable();
  },
  async validateRequest(): Promise<string> {
    return unavailable();
  },
  async authorizeOperation(): Promise<string> {
    return unavailable();
  },
  async readFile(): Promise<string> {
    return unavailable();
  },
  async shutdown(): Promise<string> {
    return unavailable();
  },
};

export default transport;
