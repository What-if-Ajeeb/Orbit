import React from 'react';
import { render, waitFor } from '@testing-library/react-native';

import { OrientationController } from './OrientationController';

const mockLockAsync = jest.fn(async () => undefined);
const mockUnlockAsync = jest.fn(async () => undefined);

const mockResponsive = {
  isTablet: false,
};

jest.mock('expo-screen-orientation', () => ({
  __esModule: true,
  lockAsync: (...args: unknown[]) => mockLockAsync(...args),
  unlockAsync: (...args: unknown[]) => mockUnlockAsync(...args),
  OrientationLock: { PORTRAIT_UP: 'PORTRAIT_UP' },
}));

jest.mock('@/hooks/useResponsiveLayout', () => ({
  useResponsiveLayout: () => mockResponsive,
}));

describe('OrientationController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResponsive.isTablet = false;
  });

  it('keeps phones locked to portrait', async () => {
    await render(<OrientationController />);

    await waitFor(() =>
      expect(mockLockAsync).toHaveBeenCalledWith('PORTRAIT_UP')
    );
    expect(mockUnlockAsync).not.toHaveBeenCalled();
  });

  it('lets tablets rotate freely', async () => {
    mockResponsive.isTablet = true;

    await render(<OrientationController />);

    await waitFor(() => expect(mockUnlockAsync).toHaveBeenCalledTimes(1));
    expect(mockLockAsync).not.toHaveBeenCalled();
  });
});
