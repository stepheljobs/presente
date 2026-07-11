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

export interface SignupInput {
  companyName: string;
  email: string;
  phone?: string;
  password: string;
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function signup(input: SignupInput): Promise<void> {
  const res = await postJson('/auth/signup', input);
  if (res.status === 409) {
    throw new Error(
      'An account with this email already exists — try signing in instead.',
    );
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string | string[];
    } | null;
    const message = Array.isArray(body?.message)
      ? body.message[0]
      : body?.message;
    throw new Error(message ?? 'Sign-up failed — try again');
  }
}

/** Verifies the emailed code; on success the session token is stored. */
export async function verifyOtp(email: string, code: string): Promise<void> {
  const res = await postJson('/auth/verify-otp', { email, code });
  const body = (await res.json().catch(() => null)) as {
    accessToken?: string;
    message?: string;
  } | null;
  if (!res.ok || !body?.accessToken) {
    throw new Error(body?.message ?? 'Verification failed — try again');
  }
  localStorage.setItem(TOKEN_KEY, body.accessToken);
}

export async function resendOtp(email: string): Promise<void> {
  const res = await postJson('/auth/resend-otp', { email });
  if (res.status === 429) {
    throw new Error('Too many codes requested — try again in an hour');
  }
  if (!res.ok) throw new Error('Could not resend the code — try again');
}
