import { isRunningInExpoGo } from 'expo';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { apiFetch } from './api';

/**
 * Push + local notifications are production / native builds only.
 *
 * Expo Go (Android, SDK 53+): real `expo-notifications` throws on import.
 * Metro stubs the package in dev (see metro.config.js); this gate also
 * skips register/schedule so we never call push APIs there.
 *
 * Override (native dev client only): EXPO_PUBLIC_ENABLE_PUSH=true
 */
export function isNotificationsEnabled(): boolean {
  if (Platform.OS === 'web') return false;
  if (isRunningInExpoGo()) return false;
  if (process.env.EXPO_PUBLIC_ENABLE_PUSH === 'false') return false;
  if (process.env.EXPO_PUBLIC_ENABLE_PUSH === 'true') return true;
  // Default: only in production (release) builds.
  return !__DEV__;
}

type NotificationsModule = typeof import('expo-notifications');

async function loadNotifications(): Promise<NotificationsModule | null> {
  if (!isNotificationsEnabled()) return null;
  try {
    return await import('expo-notifications');
  } catch {
    return null;
  }
}

/** Wire foreground presentation once (only when the module is available). */
export async function configureNotificationHandler(): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {
    /* native module unavailable */
  }
}

/**
 * E9-S01: request permission, obtain Expo push token, register with API.
 * No-op in development / Expo Go / web — and never loads expo-notifications there.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  const Notifications = await loadNotifications();
  if (!Notifications) return null;

  try {
    if (!Device.isDevice) {
      // Emulators often lack FCM.
    }

    const { status: existing } = await Notifications.getPermissionsAsync();
    let final = existing;
    if (existing !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      final = req.status;
    }
    if (final !== 'granted') return null;

    const tokenRes = await Notifications.getExpoPushTokenAsync();
    const token = tokenRes.data;
    if (!token) return null;

    await apiFetch('/notifications/devices', {
      method: 'POST',
      body: {
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      },
    });
    return token;
  } catch {
    return null;
  }
}

/** Local (immediate) notification — only when the native module is loaded. */
export async function scheduleLocalNotification(input: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): Promise<void> {
  const Notifications = await loadNotifications();
  if (!Notifications) return;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') {
      const req = await Notifications.requestPermissionsAsync();
      if (req.status !== 'granted') return;
    }
    await Notifications.scheduleNotificationAsync({
      content: {
        title: input.title,
        body: input.body,
        data: input.data,
      },
      trigger: null,
    });
  } catch {
    /* optional */
  }
}
