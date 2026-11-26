import type {
  PluginManifest,
  PluginPlatform,
} from './types';

export const ALL_PLUGIN_PLATFORMS: PluginPlatform[] = [
  'android',
  'ios',
  'web',
];

type ManifestSeed = Partial<PluginManifest> &
  Pick<
    PluginManifest,
    | 'pluginId'
    | 'name'
    | 'version'
    | 'description'
    | 'category'
    | 'minimumOrbitVersion'
    | 'platformSupport'
    | 'entryPoint'
  >;

/**
 * Fills the canonical empty fields for a manifest bundled with ORBIT.
 * Every bundled plugin — core Cordis metadata, diagnostics and native plugins —
 * uses this helper so validation rules stay in one place.
 */
export function seedPluginManifest(input: ManifestSeed): PluginManifest {
  return {
    manifestVersion: 1,
    author: { name: 'ORBIT' },
    publisher: {
      id: 'orbit',
      name: 'ORBIT',
      verified: true,
    },
    icon: 'extension-puzzle-outline',
    permissions: [],
    capabilities: [],
    dependencies: [],
    optionalDependencies: [],
    routes: [],
    navigationEntries: [],
    dashboardWidgets: [],
    settingsSections: [],
    settingsSchema: [],
    toolbarActions: [],
    contextActions: [],
    mcpTools: [],
    events: { emits: [], listens: [] },
    lifecycleHooks: [],
    dataSchemaVersion: 1,
    updatePolicy: 'manual',
    ...input,
  };
}
