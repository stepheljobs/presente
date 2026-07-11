/**
 * Web-only auth module — uses localStorage instead of expo-secure-store.
 * Metro automatically picks up `*.web.ts` over `*.ts` on the web platform.
 */
import { decodeJwt, isExpired, Role } from './jwt';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';
const TOKEN_KEY = 'presente.accessToken';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  tenantId: string;
}

export async function loadUser(): Promise<SessionUser | null> {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;
  const claims = decodeJwt(token);
  if (!claims || isExpired(claims)) {
    localStorage.removeItem(TOKEN_KEY);
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
  return Promise.resolve(localStorage.getItem(TOKEN_KEY));
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
  localStorage.setItem(TOKEN_KEY, body.accessToken);
  const user = await loadUser();
  if (!user) throw new Error('Login failed — try again');
  return user;
}

export async function logout(): Promise<void> {
  localStorage.removeItem(TOKEN_KEY);
}
