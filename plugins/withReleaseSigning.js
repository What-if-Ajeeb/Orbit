const fs = require('fs');
const path = require('path');
const { withAppBuildGradle } = require('@expo/config-plugins');

const SIGNING_BLOCK = `    signingConfigs {
        debug {
            storeFile file('debug.keystore')
            storePassword 'android'
            keyAlias 'androiddebugkey'
            keyPassword 'android'
        }
        release {
            def releaseStoreFile = System.getenv('ORBIT_KEYSTORE_PATH')
            def releaseStorePassword = System.getenv('ORBIT_RELEASE_STORE_PASSWORD')
            def releaseKeyAlias = System.getenv('ORBIT_RELEASE_KEY_ALIAS')
            def releaseKeyPassword = System.getenv('ORBIT_RELEASE_KEY_PASSWORD')
            def requireReleaseSigning = System.getenv('ORBIT_REQUIRE_RELEASE_SIGNING') == '1'
            if (releaseStoreFile && releaseStorePassword && releaseKeyAlias && releaseKeyPassword) {
                storeFile file(releaseStoreFile)
                storePassword releaseStorePassword
                keyAlias releaseKeyAlias
                keyPassword releaseKeyPassword
            } else if (requireReleaseSigning) {
                throw new GradleException('Release signing is required but ORBIT_KEYSTORE_PATH/ORBIT_RELEASE_STORE_PASSWORD/ORBIT_RELEASE_KEY_ALIAS/ORBIT_RELEASE_KEY_PASSWORD are missing.')
            } else {
                storeFile file('debug.keystore')
                storePassword 'android'
                keyAlias 'androiddebugkey'
                keyPassword 'android'
            }
        }
    }`;

function hasReleaseSigning(contents) {
  return (
    contents.includes("System.getenv('ORBIT_KEYSTORE_PATH')") &&
    contents.includes("signingConfig signingConfigs.release")
  );
}

function applyReleaseSigning(contents) {
  if (hasReleaseSigning(contents)) {
    return contents;
  }

  const signingConfigsPattern = /    signingConfigs \{[\s\S]*?\n    \}\n(?=    buildTypes \{)/;
  if (!signingConfigsPattern.test(contents)) {
    throw new Error(
      'withReleaseSigning: could not find signingConfigs block in android/app/build.gradle'
    );
  }

  let next = contents.replace(signingConfigsPattern, `${SIGNING_BLOCK}\n`);

  const releaseBuildPattern = /(\n        release \{[\s\S]*?)(\n            signingConfig signingConfigs\.debug)/;
  if (!releaseBuildPattern.test(next)) {
    throw new Error(
      'withReleaseSigning: could not find release signingConfig in android/app/build.gradle'
    );
  }

  next = next.replace(releaseBuildPattern, '$1\n            signingConfig signingConfigs.release');

  // Keep a stable, idempotent shape by removing the stock caution comment if present.
  next = next.replace(
    /\n            \/\/ Caution! In production, you need to generate your own keystore file\.\n            \/\/ see https:\/\/reactnative\.dev\/docs\/signed-apk-android\./g,
    ''
  );

  return next;
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning: expected Groovy app/build.gradle');
    }
    mod.modResults.contents = applyReleaseSigning(mod.modResults.contents);
    return mod;
  });
}

module.exports = withReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
