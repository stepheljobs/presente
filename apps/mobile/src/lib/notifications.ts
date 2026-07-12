import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiFetch } from './api';

/**
 * E9-S01: request permission, obtain Expo push token, register with API.
 * Safe no-op on web / simulators without push support.
 */
export async function registerForPushNotifications(): Promise<string | null> {
  try {
    if (Platform.OS === 'web') return null;
    if (!Device.isDevice) {
      // Emulators often lack FCM; still try Expo token for Expo Go.
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
