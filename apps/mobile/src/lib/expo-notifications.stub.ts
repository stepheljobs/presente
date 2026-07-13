/**
 * Stub for `expo-notifications` used in Expo Go / Metro dev.
 *
 * Real package throws on import in Expo Go (Android, SDK 53+) because
 * DevicePushTokenAutoRegistration.fx → addPushTokenListener → warnOfExpoGoPushUsage.
 * Metro resolves to this file unless production or EXPO_PUBLIC_ENABLE_PUSH=true.
 */

type PermissionResponse = {
  status: 'granted' | 'denied' | 'undetermined';
  granted: boolean;
  canAskAgain: boolean;
  expires: 'never';
};

const denied: PermissionResponse = {
  status: 'undetermined',
  granted: false,
  canAskAgain: true,
  expires: 'never',
};

export function setNotificationHandler(_handler: unknown): void {
  /* no-op */
}

export async function getPermissionsAsync(): Promise<PermissionResponse> {
  return denied;
}

export async function requestPermissionsAsync(): Promise<PermissionResponse> {
  return denied;
}

export async function getExpoPushTokenAsync(): Promise<{ data: string; type: string }> {
  throw new Error('Push tokens unavailable in this environment (stub)');
}

export async function scheduleNotificationAsync(_input: unknown): Promise<string> {
  return 'stub';
}

export async function getDevicePushTokenAsync(): Promise<{ data: string; type: string }> {
  throw new Error('Push tokens unavailable in this environment (stub)');
}

export function addPushTokenListener(_listener: unknown): { remove: () => void } {
  return { remove: () => undefined };
}

export function addNotificationReceivedListener(_listener: unknown): {
  remove: () => void;
} {
  return { remove: () => undefined };
}

export function addNotificationResponseReceivedListener(_listener: unknown): {
  remove: () => void;
} {
  return { remove: () => undefined };
}

export default {};
