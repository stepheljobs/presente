export type Role = 'owner' | 'admin' | 'engineer';

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  tenantId: string;
}

const TOKEN_KEY = 'presente.accessToken';
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

interface JwtClaims {
  sub: string;
  email: string;
  role: Role;
  tenantId: string;
  exp?: number;
}

export function decodeJwt(token: string): JwtClaims | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(base64)) as JwtClaims;
  } catch {
    return null;
  }
}

export function isExpired(claims: JwtClaims, nowMs = Date.now()): boolean {
  return claims.exp !== undefined && claims.exp * 1000 <= nowMs;
}

/** Returns the logged-in user, or null when the token is absent/invalid/expired. */
export function currentUser(): SessionUser | null {
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

export function accessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export async function login(email: string, password: string): Promise<void> {
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
}

export function logout(): void {
  localStorage.removeItem(TOKEN_KEY);
}
