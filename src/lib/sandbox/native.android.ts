import OrbitMobileSandboxModule from '../../../modules/orbit-mobile-sandbox/src/OrbitMobileSandboxModule';

import type { SandboxTransport } from './types';

/**
 * Android-only autolinked module. Kotlin performs no policy or execution; it
 * forwards validation calls and enforces the bounded file-read boundary after
 * the isolated Rust core returns an allow decision.
 */
export default OrbitMobileSandboxModule satisfies SandboxTransport;
