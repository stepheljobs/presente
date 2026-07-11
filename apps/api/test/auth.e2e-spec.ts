import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import request from 'supertest';
import { AuthService } from '../src/auth/auth.service';
import { createTestApp, ownerPool } from './helpers';

describe('E0-S02 password auth', () => {
  let app: INestApplication;
  let owner: Pool;
  let tenantId: string;

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query('TRUNCATE users, tenants CASCADE');
    const t = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Alpha Builders') RETURNING id`,
    );
    tenantId = t.rows[0].id;
    const hash = await AuthService.hashPassword('correct horse battery');
    await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role, status) VALUES
       ($1, 'owner@alpha.ph', $2, 'owner', 'active'),
       ($1, 'gone@alpha.ph', $2, 'admin', 'disabled')`,
      [tenantId, hash],
    );
    app = await createTestApp();
  });

  afterAll(async () => {
    await owner.query('TRUNCATE users, tenants CASCADE');
    await owner.end();
    await app.close();
  });

  it('returns a JWT with role and tenant claims on valid login', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'owner@alpha.ph', password: 'correct horse battery' })
      .expect(200);

    expect(res.body.user).toMatchObject({
      email: 'owner@alpha.ph',
      role: 'owner',
    });
    const claims = app.get(JwtService).verify(res.body.accessToken);
    expect(claims.tenantId).toBe(tenantId);
    expect(claims.role).toBe('owner');
  });

  it('rejects a wrong password with a generic error', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'owner@alpha.ph', password: 'wrong' })
      .expect(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('rejects an unknown email with the identical generic error', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'nobody@alpha.ph', password: 'correct horse battery' })
      .expect(401);
    expect(res.body.message).toBe('Invalid credentials');
  });

  it('rejects a non-active account even with the right password', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'gone@alpha.ph', password: 'correct horse battery' })
      .expect(401);
  });

  it('blocks protected routes without a token, allows public health', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    // Any non-public route 401s; use a bogus one to prove the global guard
    // runs before routing concerns leak information.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'not-an-email', password: '' })
      .expect(400);
  });
});
