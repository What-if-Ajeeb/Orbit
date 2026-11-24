import exampleManifest from '../../../plugins/example-plugin/manifest.json';

import type { PluginRegistry } from './registry';
import {
  CORE_PLUGIN_MANIFESTS,
  DIAGNOSTICS_MANIFEST,
} from './builtins';

const CORE_README =
  'A core ORBIT service mounted by the Cordis harness. It is listed here so its ' +
  'state, dependencies and permissions appear in one registry. Core services ' +
  'cannot be uninstalled from the Plugin Manager.';

const DIAGNOSTICS_README =
  'A reviewed built-in plugin that contributes a plugin health widget and a ' +
  'diagnostics settings section. It subscribes to plugin error events and ' +
  'never receives access to conversations or credentials.';

const EXAMPLE_README =
  'The bundled declarative example plugin. It contributes a sidebar entry, a ' +
  'dashboard widget and a settings section, and contains no executable code. ' +
  'Use it as the starting point for third-party plugins.';

/**
 * Adds every plugin that ships with ORBIT to the local catalog. A catalog is
 * a list of available manifests, not an installation; the user still installs
 * and enables each non-core plugin explicitly.
 */
export function registerBundledCatalog(registry: PluginRegistry): void {
  for (const manifest of CORE_PLUGIN_MANIFESTS) {
    registry.registerCatalog(manifest, {
      trustLevel: 'official',
      source: 'builtin',
      readme: CORE_README,
    });
  }

  registry.registerCatalog(DIAGNOSTICS_MANIFEST, {
    trustLevel: 'official',
    source: 'builtin',
    readme: DIAGNOSTICS_README,
  });

  registry.registerCatalog(exampleManifest as unknown, {
    trustLevel: 'local',
    source: 'local',
    readme: EXAMPLE_README,
  });
}

export { exampleManifest };
