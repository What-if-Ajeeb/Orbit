import { fetch as expoFetch } from 'expo/fetch';
import { Platform } from 'react-native';

import { setMcpFetchImplementation, type FetchLike } from '../mcp/client';

import { authorizeSandboxUrl } from './adapters';

let installed = false;

/**
 * Installs the Android sandbox gate for every MCP HTTP request. The Rust core
 * validates and authorizes the concrete URL before the host fetch runs; no
 * guest code is executed. Other platforms keep the original transport.
 */
export function installSandboxMcpFetch(): void {
  if (installed || Platform.OS !== 'android') return;
  installed = true;

  const baseFetch = expoFetch as unknown as FetchLike;
  setMcpFetchImplementation(async (url, init) => {
    await authorizeSandboxUrl({ url, toolName: 'mcp_http_transport' });
    return baseFetch(url, init);
  });
}
