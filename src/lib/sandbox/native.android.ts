import OrbitMobileSandboxModule from '../../../modules/orbit-mobile-sandbox/src/OrbitMobileSandboxModule';

import type { SandboxTransport } from './types';

/** Android-only autolinked module. Kotlin performs no policy or execution. */
export default OrbitMobileSandboxModule satisfies SandboxTransport;
