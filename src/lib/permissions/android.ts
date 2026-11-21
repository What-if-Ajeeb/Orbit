import { PermissionsAndroid, Platform, type Permission } from 'react-native';

import type { AndroidPermissionState, PermissionCategory } from './types';

type AndroidPermissionSpec = {
  label: string;
  permissions: Permission[];
};

const ANDROID_PERMISSIONS: Partial<Record<PermissionCategory, AndroidPermissionSpec>> = {
  camera_microphone: {
    label: 'camera and microphone',
    permissions: [
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ],
  },
  location: {
    label: 'location',
    permissions: [
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION,
    ],
  },
  contacts: {
    label: 'contacts',
    permissions: [PermissionsAndroid.PERMISSIONS.READ_CONTACTS],
  },
};

/**
 * Requests the underlying Android runtime permission only AFTER the user has
 * approved Orbit's own permission request. The OS dialog is the final gate for
 * protected device resources.
 */
export async function ensureAndroidRuntimePermission(
  category: PermissionCategory
): Promise<{ state: AndroidPermissionState; message: string }> {
  const spec = ANDROID_PERMISSIONS[category];

  if (!spec) {
    return { state: 'not_required', message: 'No Android runtime permission is required.' };
  }

  if (Platform.OS !== 'android') {
    return {
      state: 'unavailable',
      message: `Android ${spec.label} permission is unavailable on this platform.`,
    };
  }

  try {
    for (const permission of spec.permissions) {
      const alreadyGranted = await PermissionsAndroid.check(permission);

      if (alreadyGranted) {
        continue;
      }

      const result = await PermissionsAndroid.request(permission, {
        title: `Allow Orbit to use ${spec.label}?`,
        message:
          'An agent requested this resource. Orbit will only use it for the action you approved.',
        buttonPositive: 'Allow',
        buttonNegative: 'Don’t allow',
      });

      if (result !== PermissionsAndroid.RESULTS.GRANTED) {
        return {
          state: 'denied',
          message: `Android blocked ${spec.label} access, so the agent action was cancelled.`,
        };
      }
    }

    return { state: 'granted', message: `Android ${spec.label} permission granted.` };
  } catch (error) {
    return {
      state: 'denied',
      message:
        error instanceof Error
          ? error.message
          : `Android ${spec.label} permission could not be requested.`,
    };
  }
}
