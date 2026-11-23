const fs = require('fs');
const path = require('path');

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');

const CONFIG_FILE_NAME = 'network_security_config.xml';

// Cleartext HTTP is disabled everywhere except this device's loopback address,
// which is where the native Ollama API listens. Nothing is opened to the LAN.
const NETWORK_SECURITY_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">localhost</domain>
    </domain-config>
</network-security-config>
`;

/** Create the scoped Android network security resource during prebuild. */
function withNetworkSecurityFile(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const xmlDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml'
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, CONFIG_FILE_NAME), NETWORK_SECURITY_CONFIG);
      return modConfig;
    },
  ]);
}

/**
 * Point the application at the scoped network security config and make sure the
 * old global `usesCleartextTraffic` escape hatch is never emitted.
 */
function withLocalhostCleartext(config) {
  return withAndroidManifest(withNetworkSecurityFile(config), (modConfig) => {
    const application = (modConfig.modResults.manifest.application ?? []).find((entry) =>
      entry?.$?.['android:name']?.endsWith('.MainApplication')
    );

    if (!application) {
      throw new Error('AndroidManifest.xml is missing the MainApplication element.');
    }

    application.$ = application.$ || {};
    application.$['android:networkSecurityConfig'] = `@xml/${CONFIG_FILE_NAME.replace(/\.xml$/, '')}`;
    delete application.$['android:usesCleartextTraffic'];

    return modConfig;
  });
}

module.exports = withLocalhostCleartext;
