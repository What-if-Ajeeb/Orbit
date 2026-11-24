import type { SandboxProgramManifest } from './types';

/**
 * A data-only program. Rust interprets these instructions inside the isolated
 * Android service; no JavaScript or native code is loaded from the manifest.
 */
export const EXAMPLE_SANDBOX_MANIFEST: SandboxProgramManifest = {
  pluginId: 'orbit.example.sandbox',
  version: '1.0.0',
  program: {
    version: 1,
    instructions: [
      { op: 'push', value: 'hello ' },
      { op: 'load', key: 'input', field: 'name' },
      { op: 'concat' },
      { op: 'emit', key: 'greeting' },
      { op: 'load', key: 'input', field: 'count' },
      { op: 'push', value: 2 },
      { op: 'mul' },
      { op: 'emit', key: 'doubled' },
      { op: 'return' },
    ],
  },
};

export const EXAMPLE_SANDBOX_INPUT = {
  name: 'orbit',
  count: 21,
};

export const DEFAULT_MANIFEST_JSON = JSON.stringify(EXAMPLE_SANDBOX_MANIFEST, null, 2);
export const DEFAULT_INPUT_JSON = JSON.stringify(EXAMPLE_SANDBOX_INPUT, null, 2);
