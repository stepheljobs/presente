export type Role = 'owner' | 'admin' | 'engineer';

export interface JwtClaims {
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
