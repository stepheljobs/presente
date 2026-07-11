import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Pool } from 'pg';
import request from 'supertest';
import { DEFAULT_SETTINGS } from '../src/settings/settings.service';
import { createTestApp, ownerPool } from './helpers';

describe('E1-S08 company settings', () => {
  let app: INestApplication;
  let owner: Pool;
  let ownerToken: string;
  let adminToken: string;

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query(
      'TRUNCATE company_settings, otp_codes, users, tenants CASCADE',
    );
    const t = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Alpha Builders') RETURNING id`,
    );
    const tenantId = t.rows[0].id;
    const users = await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES
       ($1, 'owner@alpha.ph', 'x', 'owner'),
       ($1, 'admin@alpha.ph', 'x', 'admin') RETURNING id, email, role`,
      [tenantId],
    );
    app = await createTestApp();
    const jwt = app.get(JwtService);
    ownerToken = jwt.sign({
      sub: users.rows[0].id,
      tenantId,
      email: users.rows[0].email,
      role: 'owner',
    });
    adminToken = jwt.sign({
      sub: users.rows[1].id,
      tenantId,
      email: users.rows[1].email,
      role: 'admin',
    });
  });

  afterAll(async () => {
    await owner.query(
      'TRUNCATE company_settings, otp_codes, users, tenants CASCADE',
    );
    await owner.end();
    await app.close();
  });

  it('returns defaults before anything is saved', async () => {
    const res = await request(app.getHttpServer())
      .get('/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(res.body).toEqual(DEFAULT_SETTINGS);
  });

  it('owner can update; change is audited and read back', async () => {
    const next = {
      ...DEFAULT_SETTINGS,
      otMultiplier: 1.3,
      lateGraceMinutes: 10,
      workdays: [1, 2, 3, 4, 5],
    };
    const res = await request(app.getHttpServer())
      .put('/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send(next)
      .expect(200);
    expect(res.body.otMultiplier).toBe(1.3);

    const read = await request(app.getHttpServer())
      .get('/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .expect(200);
    expect(read.body).toEqual(next);

    const audit = await owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE action = 'settings.update'`,
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('rejects an OT multiplier below 100%', async () => {
    await request(app.getHttpServer())
      .put('/settings')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ ...DEFAULT_SETTINGS, otMultiplier: 0.9 })
      .expect(400);
  });

  it('admin cannot write settings (Owner-only per role matrix)', async () => {
    await request(app.getHttpServer())
      .put('/settings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send(DEFAULT_SETTINGS)
      .expect(403);
  });
});
