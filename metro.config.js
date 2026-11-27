const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
config.resolver.assetExts.push('svg');
config.resolver.sourceExts = config.resolver.sourceExts.filter((ext) => ext !== 'svg');

// Expo's on-demand file map must not crawl rust/gradle build artifacts. They are
// not part of the JS graph and can contain hard-linked files that Metro cannot
// readlink() while indexing.
config.resolver.blockList = [
  ...(config.resolver.blockList ?? []),
  /(?:^|[\\/])(?:sandbox-core[\\/]target|modules[\\/][^\\/]+[\\/]build)(?:[\\/]|$)/,
];

module.exports = config;
