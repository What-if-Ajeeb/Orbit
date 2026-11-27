// Expo's module loader expects React Native's __DEV__ global in Node tests.
(globalThis as { __DEV__?: boolean }).__DEV__ = false;
