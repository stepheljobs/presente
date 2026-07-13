import { decodeJwt, isExpired, Role } from './jwt';
import * as SecureStore from './secure-store';

// Android emulator reaches the host machine at 10.0.2.2, not localhost —
// set EXPO_PUBLIC_API_URL accordingly when testing on-device.
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:3000';

const TOKEN_KEY = 'presente.accessToken';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  tenantId: string;
}

/** Token lives in EncryptedSharedPreferences/Keystore via SecureStore. */
export async function loadUser(): Promise<SessionUser | null> {
  const token = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!token) return null;
  const claims = decodeJwt(token);
  if (!claims || isExpired(claims)) {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    return null;
  }
  return {
    id: claims.sub,
    email: claims.email,
    role: claims.role,
    tenantId: claims.tenantId,
  };
}

export function accessToken(): Promise<string | null> {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function login(
  email: string,
  password: string,
): Promise<SessionUser> {
  const res = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    throw new Error(
      res.status === 401 ? 'Invalid credentials' : 'Login failed — try again',
    );
  }
  const body = (await res.json()) as { accessToken: string };
  await SecureStore.setItemAsync(TOKEN_KEY, body.accessToken);
  const user = await loadUser();
  if (!user) throw new Error('Login failed — try again');
  return user;
}

export async function logout(): Promise<void> {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
