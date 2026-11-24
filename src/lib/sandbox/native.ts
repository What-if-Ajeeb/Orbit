import {
  SandboxUnavailableError,
  type SandboxTransport,
} from './types';

/** Non-Android fallback. The native module is never loaded on these platforms. */
const transport: SandboxTransport = {
  async describe(): Promise<string> {
    throw new SandboxUnavailableError();
  },
  async validateManifest(): Promise<string> {
    throw new SandboxUnavailableError();
  },
  async execute(): Promise<string> {
    throw new SandboxUnavailableError();
  },
  async shutdown(): Promise<string> {
    throw new SandboxUnavailableError();
  },
};

export default transport;
