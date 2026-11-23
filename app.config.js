const appJson = require('./app.json');

function versionCodeFromVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version || '');
  if (!match) {
    throw new Error(`expo.version must be MAJOR.MINOR.PATCH, got: ${version}`);
  }
  const [, major, minor, patch] = match.map(Number);
  if (minor >= 1000 || patch >= 1000) {
    throw new Error('MINOR and PATCH must be below 1000 to fit android.versionCode');
  }
  return major * 1_000_000 + minor * 1_000 + patch;
}

module.exports = ({ config }) => {
  const expo = {
    ...appJson.expo,
    ...config,
    android: {
      ...appJson.expo.android,
      ...(config.android || {}),
      versionCode: versionCodeFromVersion(appJson.expo.version),
    },
    plugins: [...(appJson.expo.plugins || []), './plugins/withReleaseSigning.js'],
  };

  return { ...config, ...appJson, expo };
};
