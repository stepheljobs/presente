import { describe, expect, it } from 'vitest';
import { decodeJwt, isExpired } from './auth';

function fakeJwt(claims: object): string {
  const b64 = (o: object) =>
    btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256' })}.${b64(claims)}.signature`;
}

describe('decodeJwt', () => {
  it('decodes role and tenant claims', () => {
    const token = fakeJwt({
      sub: 'u1',
      email: 'a@b.ph',
      role: 'admin',
      tenantId: 't1',
    });
    expect(decodeJwt(token)).toMatchObject({ role: 'admin', tenantId: 't1' });
  });

  it('returns null for garbage tokens', () => {
    expect(decodeJwt('not-a-jwt')).toBeNull();
    expect(decodeJwt('a.%%%.c')).toBeNull();
  });
});

describe('isExpired', () => {
  const now = 1_752_200_000_000;

  it('is false before exp and true after', () => {
    expect(isExpired({ sub: '', email: '', role: 'owner', tenantId: '', exp: now / 1000 + 60 }, now)).toBe(false);
    expect(isExpired({ sub: '', email: '', role: 'owner', tenantId: '', exp: now / 1000 - 60 }, now)).toBe(true);
  });

  it('treats missing exp as not expired', () => {
    expect(isExpired({ sub: '', email: '', role: 'owner', tenantId: '' }, now)).toBe(false);
  });
});
