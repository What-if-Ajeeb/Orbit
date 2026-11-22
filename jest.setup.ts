import '@testing-library/jest-native/extend-expect';

jest.mock('expo-speech', () => ({
  speak: jest.fn(),
  stop: jest.fn(),
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
}));

jest.mock('expo-asset', () => ({
  Asset: {
    fromModule: jest.fn(() => ({
      downloadAsync: jest.fn(async () => undefined),
      localUri: 'file:///mock.svg',
      uri: 'file:///mock.svg',
    })),
  },
}));
