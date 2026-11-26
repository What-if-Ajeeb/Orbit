/**
 * Installation and lifecycle seams for locally authored plugins.
 *
 * This module never creates a second registry, store or runtime. It compiles a
 * builder draft into a canonical v1 manifest, asks the existing approval host,
 * and drives the canonical registry. Actions are inert MCP tool metadata; no
 * builder-authored code is supplied and no guest program is registered.
 */
import { satisfiesRange } from '@/lib/plugins/semver';

import { appendBuilderLog } from './builder-store';
import {
  buildManifest,
  validateAndBuild,
  type BuilderDraft,
} from './builder';
import {
  pluginApprovalService,
  type PluginApprovalService,
} from './approvals';
import { manifestPlatformSupported } from './manifest';
import { isSensitivePermission, PLUGIN_PERMISSION_META } from './permissions';
import type { PluginPersistence } from './persistence';
import type { PluginPlatformRuntime } from './platform';
import type {
  PluginManifest,
  PluginPermission,
  PluginRecord,
} from './types';

const INSTALLED_STATUSES = new Set([
  'installed',
  'disabled',
  'enabling',
  'enabled',
  'starting',
  'running',
  'stopping',
  'error',
  'updating',
]);

export type BuilderApprovals = Pick<
  PluginApprovalService,
  'requestInstall' | 'requestPermissions'
>;

export type BuilderActionResult = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  record?: PluginRecord;
};

export type BuilderServiceOptions = {
  approvals?: BuilderApprovals;
  persistence?: PluginPersistence;
  now?: () => number;
};

function isInstalled(record: PluginRecord | null | undefined): boolean {
  return Boolean(record && INSTALLED_STATUSES.has(record.status));
}

function isLocalBuilderRecord(record: PluginRecord | null | undefined): boolean {
  return Boolean(record && record.trustLevel === 'local' && record.source === 'local');
}

function unique<T>(values: T[]): T[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function permissionLabels(permissions: PluginPermission[]): string {
  return permissions.map((permission) => PLUGIN_PERMISSION_META[permission].label).join(', ');
}

function log(
  persistence: PluginPersistence,
  pluginId: string,
  actionId: string | null,
  level: 'info' | 'error',
  message: string
): void {
  void appendBuilderLog(persistence, { pluginId, actionId, level, message }).catch(() => {
    // Logging is best effort and must never change a lifecycle outcome.
  });
}

function inspectionFor(
  platform: PluginPlatformRuntime,
  manifest: PluginManifest,
  warnings: string[]
) {
  const compatible =
    manifestPlatformSupported(manifest, platform.platform) &&
    satisfiesRange(platform.appVersion, `>=${manifest.minimumOrbitVersion}`);
  const sensitivePermissions = manifest.permissions.filter(isSensitivePermission);

  const dependencies = manifest.dependencies.map((dependency) => {
    const record = platform.registry.getRecord(dependency.pluginId);
    return {
      pluginId: dependency.pluginId,
      name: record?.manifest.name ?? dependency.pluginId,
      version: dependency.version,
      installed: isInstalled(record),
      running: record?.status === 'running',
    };
  });

  const inspectionWarnings = [...warnings];

  if (!compatible) {
    inspectionWarnings.push('This plugin is not compatible with this ORBIT version or platform.');
  }

  if (sensitivePermissions.length > 0) {
    inspectionWarnings.push(`Sensitive access: ${permissionLabels(sensitivePermissions)}.`);
  }

  if (manifest.mcpTools.length > 0) {
    inspectionWarnings.push(
      'Declared actions are metadata only. The sandbox never executes guest code.'
    );
  }

  return {
    pluginId: manifest.pluginId,
    pluginName: manifest.name,
    version: manifest.version,
    publisherId: manifest.publisher.id.slice(0, 120),
    publisherName: manifest.publisher.name.slice(0, 120),
    publisherVerified: manifest.publisher.verified,
    trustLevel: 'local' as const,
    registry: 'device-builder',
    compatible,
    minimumOrbitVersion: manifest.minimumOrbitVersion,
    platformSupport: manifest.platformSupport.slice(),
    entryPointKind: manifest.entryPoint.kind,
    dependencies,
    sensitivePermissions,
    requiresSandbox:
      manifest.permissions.includes('files.read') ||
      manifest.permissions.includes('network.access'),
    warnings: unique(inspectionWarnings).slice(0, 8),
  };
}

/** Validates and exports the canonical manifest as pretty JSON. */
export function exportBuilderManifest(draft: BuilderDraft): string {
  const validation = validateAndBuild(draft);

  if (!validation.ok || !validation.manifest) {
    throw new Error(validation.errors.join(' ') || 'Draft is not valid.');
  }

  return JSON.stringify(validation.manifest, null, 2);
}

/** Locally marks a validated draft as ready for a reviewed submission. */
export function prepareBuilderDraftForPublish(draft: BuilderDraft): BuilderDraft {
  const validation = validateAndBuild(draft);

  if (!validation.ok) {
    throw new Error(validation.errors.join(' ') || 'Draft is not valid.');
  }

  return { ...draft, preparedForPublish: true, updatedAt: Date.now() };
}

/**
 * Installs or updates a locally built plugin after explicit install approval.
 * Permissions are never auto-granted at this stage.
 */
export async function installBuilderDraft(
  platform: PluginPlatformRuntime,
  draft: BuilderDraft,
  options: BuilderServiceOptions = {}
): Promise<BuilderActionResult> {
  const validation = validateAndBuild(draft);

  if (!validation.ok || !validation.manifest) {
    return {
      ok: false,
      errors: validation.errors,
      warnings: validation.warnings,
    };
  }

  const manifest = validation.manifest;
  const approvals = options.approvals ?? pluginApprovalService;
  const persistence = options.persistence ?? platform.persistence;
  const record = platform.registry.getRecord(manifest.pluginId);

  if (record && !isLocalBuilderRecord(record)) {
    return {
      ok: false,
      errors: [
        `Plugin ID "${manifest.pluginId}" is already used by another plugin. Choose a different ID.`,
      ],
      warnings: validation.warnings,
    };
  }

  const alreadyInstalled = isInstalled(record);
  const requiresUpdate =
    alreadyInstalled && record!.manifest.version !== manifest.version;

  if (
    requiresUpdate &&
    !satisfiesRange(manifest.version, `>${record!.manifest.version}`)
  ) {
    return {
      ok: false,
      errors: [
        `Increase the version before updating. Installed: ${record!.manifest.version}; draft: ${manifest.version}.`,
      ],
      warnings: validation.warnings,
    };
  }

  const inspection = inspectionFor(platform, manifest, validation.warnings);
  const approved = await approvals.requestInstall({
    pluginId: manifest.pluginId,
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    trustLevel: 'local',
    capability: manifest.entryPoint.kind,
    capabilityLabel: 'Declarative plugin',
    reason:
      'Install this locally built plugin? Permissions stay default-deny. Actions are metadata only; the sandbox never executes code.',
    permissions: manifest.permissions,
    sensitivePermissions: manifest.permissions.filter(isSensitivePermission),
    dependencies: inspection.dependencies.map((dependency) => ({
      pluginId: dependency.pluginId,
      name: dependency.name,
      version: dependency.version,
      permissions:
        platform.registry.getRecord(dependency.pluginId)?.manifest.permissions ?? [],
      installed: dependency.installed,
      running: dependency.running,
    })),
    requiresSandbox: inspection.requiresSandbox,
    requiresUpdate,
    steps: [
      'Validate the canonical version-1 manifest.',
      'Review exact permissions and dependencies.',
      'Install locally; no code is downloaded or evaluated.',
    ],
    inspection,
  });

  if (!approved) {
    log(persistence, manifest.pluginId, null, 'info', 'Install was cancelled during approval.');
    return {
      ok: false,
      errors: ['Install cancelled. No changes were made.'],
      warnings: validation.warnings,
    };
  }

  try {
    if (!record) {
      platform.registry.discover(manifest, { trustLevel: 'local', source: 'local' });
    }

    let nextRecord: PluginRecord;

    if (!alreadyInstalled) {
      nextRecord = await platform.registry.install(manifest.pluginId);
    } else if (requiresUpdate) {
      const addedPermissions = manifest.permissions.filter(
        (permission) => !record!.manifest.permissions.includes(permission)
      );

      nextRecord = await platform.registry.update(manifest.pluginId, manifest, {
        approveAddedPermissions: addedPermissions,
      });
    } else {
      nextRecord = record!;
    }

    log(
      persistence,
      manifest.pluginId,
      null,
      'info',
      `${requiresUpdate ? 'Updated' : 'Installed'} local plugin ${manifest.pluginId}@${manifest.version}.`
    );

    return { ok: true, errors: [], warnings: validation.warnings, record: nextRecord };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Install failed.';
    log(persistence, manifest.pluginId, null, 'error', message);
    return { ok: false, errors: [message], warnings: validation.warnings };
  }
}

/** Enables a local plugin through the same permission approval host. */
export async function enableBuilderPlugin(
  platform: PluginPlatformRuntime,
  pluginId: string,
  options: BuilderServiceOptions = {}
): Promise<BuilderActionResult> {
  const record = platform.registry.getRecord(pluginId);

  if (!record) {
    return { ok: false, errors: ['Plugin is not registered.'], warnings: [] };
  }

  if (!isLocalBuilderRecord(record)) {
    return {
      ok: false,
      errors: ['Only plugins installed by this builder can be managed here.'],
      warnings: [],
    };
  }

  if (record.status === 'running') {
    return { ok: true, errors: [], warnings: [], record };
  }

  const approvals = options.approvals ?? pluginApprovalService;
  const persistence = options.persistence ?? platform.persistence;
  const missing = unique(
    platform.permissions.missing(pluginId, record.manifest.permissions)
  );
  let approvedPermissions: PluginPermission[] = [];

  if (missing.length > 0) {
    const approved = await approvals.requestPermissions({
      pluginId,
      pluginName: record.manifest.name,
      trustLevel: record.trustLevel,
      permissions: missing,
      reason: `Enabling ${record.manifest.name} requires ${permissionLabels(missing)}.`,
    });

    if (!approved) {
      log(persistence, pluginId, null, 'info', 'Enable cancelled during permission approval.');
      return {
        ok: false,
        errors: ['Enable cancelled. No permissions were granted.'],
        warnings: [],
      };
    }

    approvedPermissions = missing;
  }

  try {
    const nextRecord = await platform.registry.enable(pluginId, {
      approvePermissions: approvedPermissions,
    });

    log(persistence, pluginId, null, 'info', `Enabled local plugin ${pluginId}.`);
    return { ok: true, errors: [], warnings: [], record: nextRecord };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Enable failed.';
    log(persistence, pluginId, null, 'error', message);
    return { ok: false, errors: [message], warnings: [] };
  }
}

export async function disableBuilderPlugin(
  platform: PluginPlatformRuntime,
  pluginId: string
): Promise<BuilderActionResult> {
  const record = platform.registry.getRecord(pluginId);

  if (!isLocalBuilderRecord(record)) {
    return {
      ok: false,
      errors: ['Only plugins installed by this builder can be managed here.'],
      warnings: [],
    };
  }

  try {
    const disabled = await platform.registry.disable(pluginId);
    log(platform.persistence, pluginId, null, 'info', `Disabled local plugin ${pluginId}.`);
    return { ok: true, errors: [], warnings: [], record: disabled };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : 'Disable failed.'],
      warnings: [],
    };
  }
}

export async function uninstallBuilderPlugin(
  platform: PluginPlatformRuntime,
  pluginId: string
): Promise<BuilderActionResult> {
  const record = platform.registry.getRecord(pluginId);

  if (!isLocalBuilderRecord(record)) {
    return {
      ok: false,
      errors: ['Only plugins installed by this builder can be managed here.'],
      warnings: [],
    };
  }

  try {
    await platform.registry.uninstall(pluginId, { deleteData: false });
    log(platform.persistence, pluginId, null, 'info', `Uninstalled local plugin ${pluginId}.`);
    return { ok: true, errors: [], warnings: [] };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : 'Uninstall failed.'],
      warnings: [],
    };
  }
}

/** Builds a manifest without installing it, used by the live review preview. */
export function previewBuilderManifest(draft: BuilderDraft): PluginManifest {
  const validation = validateAndBuild(draft);

  if (!validation.ok || !validation.manifest) {
    throw new Error(validation.errors.join(' ') || 'Draft is not valid.');
  }

  return validation.manifest;
}

export { buildManifest };
