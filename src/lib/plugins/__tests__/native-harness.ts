import {
  CORE_PLUGIN_MANIFESTS,
  registerBuiltinImplementations,
} from '../builtins';
import { registerBundledCatalog } from '../catalog';
import { createHarness, type Harness } from './helpers';

/** Creates a registry harness with the five adopted core plugins ready. */
export async function createNativeHarness(
  options: Parameters<typeof createHarness>[0] = {}
): Promise<Harness> {
  const harness = createHarness(options);
  registerBundledCatalog(harness.registry);
  registerBuiltinImplementations(harness.registry);

  for (const manifest of CORE_PLUGIN_MANIFESTS) {
    await harness.registry.adopt(manifest, {
      trustLevel: 'official',
      source: 'builtin',
      status: 'running',
      enabled: true,
    });
  }

  return harness;
}
