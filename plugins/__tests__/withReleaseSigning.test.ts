import { describe, expect, it } from 'vitest';
// @ts-expect-error - plugin is CommonJS for Expo config compatibility
import { applyReleaseSigning } from '../withReleaseSigning.js';

const SAMPLE_GRADLE = `android {
    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
        release {
            // Caution! In production, you need to generate your own keystore file.
            // see https://reactnative.dev/docs/signed-apk-android.
            signingConfig signingConfigs.debug
            def enableShrinkResources = findProperty('android.enableShrinkResourcesInReleaseBuilds') ?: 'false'
            shrinkResources enableShrinkResources.toBoolean()
            minifyEnabled enableMinifyInReleaseBuilds
            proguardFiles getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro"
            def enablePngCrunchInRelease = findProperty('android.enablePngCrunchInReleaseBuilds') ?: 'true'
            crunchPngs enablePngCrunchInRelease.toBoolean()
        }
    }
}
`;

describe('withReleaseSigning', () => {
  it('patches release signing and is idempotent', () => {
    const once = applyReleaseSigning(SAMPLE_GRADLE);
    const twice = applyReleaseSigning(once);

    expect(once).toContain("System.getenv('ORBIT_KEYSTORE_PATH')");
    expect(once).toContain("System.getenv('ORBIT_REQUIRE_RELEASE_SIGNING') == '1'");
    expect(once).toContain('signingConfig signingConfigs.release');
    expect(once).not.toContain('Caution! In production, you need to generate your own keystore file.');
    expect(twice).toBe(once);
  });

  it('throws when required Gradle blocks are missing', () => {
    expect(() => applyReleaseSigning('android {}')).toThrow(/signingConfigs block/);
  });
});
