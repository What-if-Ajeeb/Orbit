import { describe, expect, it } from 'vitest';

import {
  assertValidManifest,
  ManifestValidationError,
  type ManifestValidationResult,
  validateManifest,
} from '../manifest';
import { makeManifest, rawManifest } from './helpers';

function errorsOf(result: ManifestValidationResult): string[] {
  if (result.ok) {
    throw new Error('Expected manifest validation to fail.');
  }

  return result.errors;
}

describe('manifest strict validation', () => {
  it('accepts a complete manifest and normalizes optional fields', () => {
    const raw = rawManifest();
    delete raw.manifestVersion;
    delete raw.dataSchemaVersion;
    delete raw.updatePolicy;

    const result = validateManifest(raw);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toContain('manifestVersion is missing; assuming version 1.');
    expect(result.manifest.manifestVersion).toBe(1);
    expect(result.manifest.dataSchemaVersion).toBe(1);
    expect(result.manifest.updatePolicy).toBe('manual');
    expect(result.manifest.entryPoint).toEqual({ kind: 'declarative', screen: 'plugin-home' });
  });

  it('rejects unknown top-level fields instead of passing them through', () => {
    const result = validateManifest(rawManifest({ code: 'return eval("1+1")' }));

    expect(result.ok).toBe(false);
    expect(errorsOf(result).join(' ')).toMatch(/Unknown manifest field "code"/);
  });

  it('rejects non-objects, bad ids, bad versions and unsupported enums', () => {
    expect(errorsOf(validateManifest('not an object'))).toEqual([
      'Manifest must be a JSON object.',
    ]);

    const result = validateManifest(
      rawManifest({
        pluginId: 'Bad_ID',
        version: '1.2',
        minimumOrbitVersion: 'v1.0',
        category: 'magic',
        permissions: ['root.access'],
        capabilities: ['code.execute'],
      })
    );

    expect(result.ok).toBe(false);
    const errors = errorsOf(result).join(' ');
    expect(errors).toMatch(/pluginId must be lowercase/);
    expect(errors).toMatch(/version must be a valid semantic version/);
    expect(errors).toMatch(/minimumOrbitVersion must be a valid semantic version/);
    expect(errors).toMatch(/category must be one of/);
    expect(errors).toMatch(/permissions\[0\] is not supported/);
    expect(errors).toMatch(/capabilities\[0\] is not supported/);
  });

  it('enforces manifest version and platform support rules', () => {
    const future = validateManifest(rawManifest({ manifestVersion: 2 }));
    expect(future.ok).toBe(false);
    expect(errorsOf(future).join(' ')).toMatch(/newer than this app supports/);

    const zero = validateManifest(rawManifest({ manifestVersion: 0 }));
    expect(zero.ok).toBe(false);
    expect(errorsOf(zero).join(' ')).toMatch(/positive integer/);

    const noPlatforms = validateManifest(rawManifest({ platformSupport: [] }));
    expect(noPlatforms.ok).toBe(false);
    expect(errorsOf(noPlatforms).join(' ')).toMatch(/non-empty array/);

    const duplicates = validateManifest(
      rawManifest({ platformSupport: ['android', 'android'] })
    );
    expect(duplicates.ok).toBe(false);
    expect(errorsOf(duplicates).join(' ')).toMatch(/duplicate "android"/);

    const invalidPlatform = validateManifest(
      rawManifest({ platformSupport: ['toaster'] })
    );
    expect(invalidPlatform.ok).toBe(false);
    expect(errorsOf(invalidPlatform).join(' ')).toMatch(/platformSupport\[0\]/);
  });

  it('accepts only the three declarative entry point kinds', () => {
    const script = validateManifest(
      rawManifest({ entryPoint: { kind: 'script', path: './payload.js' } })
    );
    expect(script.ok).toBe(false);
    expect(errorsOf(script).join(' ')).toMatch(/entryPoint.kind must be one of/);

    const pathAsModule = validateManifest(
      rawManifest({ entryPoint: { kind: 'builtin', moduleId: '../evil/payload' } })
    );
    expect(pathAsModule.ok).toBe(false);
    expect(errorsOf(pathAsModule).join(' ')).toMatch(
      /entryPoint.moduleId must be a registered built-in module id/
    );

    const badScreen = validateManifest(
      rawManifest({ entryPoint: { kind: 'declarative', screen: 'chat' } })
    );
    expect(badScreen.ok).toBe(false);
    expect(errorsOf(badScreen).join(' ')).toMatch(/entryPoint.screen only supports/);

    expect(
      validateManifest(
        rawManifest({ entryPoint: { kind: 'builtin', moduleId: 'orbit-session' } })
      ).ok
    ).toBe(true);
    expect(
      validateManifest(rawManifest({ entryPoint: { kind: 'mcp' } })).ok
    ).toBe(true);
  });

  it('validates contribution ids, references and duplicate declarations', () => {
    const result = validateManifest(
      rawManifest({
        routes: [
          { id: 'home', screen: 'plugin-home', title: 'Home' },
          { id: 'home', screen: 'plugin-home', title: 'Again' },
          { id: 'bad screen', screen: 'chat', title: '' },
        ],
        navigationEntries: [
          { id: 'nav', label: 'Nav', icon: 'home', routeId: 'missing' },
        ],
      })
    );

    expect(result.ok).toBe(false);
    const errors = errorsOf(result).join(' ');
    expect(errors).toMatch(/routes contains duplicate "home"/);
    expect(errors).toMatch(/routes\[2\]\.id is not a valid contribution id/);
    expect(errors).toMatch(/navigationEntries\[0\]\.routeId must reference a route/);
  });

  it('validates event names, settings schemas and MCP tool declarations', () => {
    const result = validateManifest(
      rawManifest({
        events: { emits: ['bad/Name', 'bad/Name'], listens: 'nope' },
        settingsSchema: [
          {
            key: 'mode',
            type: 'select',
            label: 'Mode',
            options: [{ value: 'fast', label: 'Fast' }],
            default: 'slow',
          },
        ],
        mcpTools: [
          { name: '1invalid', description: 'Bad name' },
          { name: 'valid_name', description: 'Good' },
          { name: 'valid_name', description: 'Duplicate' },
        ],
      })
    );

    expect(result.ok).toBe(false);
    const errors = errorsOf(result).join(' ');
    expect(errors).toMatch(/events\.emits contains invalid event name/);
    expect(errors).toMatch(/duplicate "bad\/Name"/);
    expect(errors).toMatch(/events\.listens must be an array/);
    expect(errors).toMatch(/default must match one of the select options/);
    expect(errors).toMatch(/mcpTools\[0\]\.name is invalid/);
    expect(errors).toMatch(/mcpTools contains duplicate "valid_name"/);
  });

  it('validates dependencies, rejects self-dependencies and bad ranges', () => {
    const result = validateManifest(
      rawManifest({
        dependencies: [
          { pluginId: 'test.plugin', version: '^1.0.0' },
          { pluginId: 'other.plugin', version: 'not a range' },
          { pluginId: 'other.plugin', version: '^1.0.0' },
        ],
      })
    );

    expect(result.ok).toBe(false);
    const errors = errorsOf(result).join(' ');
    expect(errors).toMatch(/cannot depend on the plugin itself/);
    expect(errors).toMatch(/version is not a valid semantic-version range/);
    expect(errors).toMatch(/duplicate dependency "other.plugin"/);
  });

  it('warns about unused navigation declarations and reserved file permissions', () => {
    const result = validateManifest(
      rawManifest({
        capabilities: ['ui.navigation'],
        permissions: ['files.read'],
      })
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings.join(' ')).toMatch(/ui.navigation capability is declared/);
    expect(result.warnings.join(' ')).toMatch(/files permissions are reserved/);
  });

  it('assertValidManifest throws a structured error for untrusted input', () => {
    expect(() => assertValidManifest(makeManifest())).not.toThrow();

    try {
      assertValidManifest(rawManifest({ name: '' }));
      expect.unreachable('expected a validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(ManifestValidationError);
      expect((error as ManifestValidationError).errors.join(' ')).toMatch(/name is required/);
    }
  });
});
