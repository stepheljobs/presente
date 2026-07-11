import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import request from 'supertest';
import { createTestApp, ownerPool } from './helpers';

describe('E0-S05/S06/S10 audit log + idempotent session ingest', () => {
  let app: INestApplication;
  let owner: Pool;
  let engineerToken: string;
  let adminToken: string;

  const body = {
    type: 'time_in',
    deviceId: 'pixel-4a-01',
    deviceCapturedAt: '2026-07-11T07:02:11.000Z',
    deviceSentAt: new Date().toISOString(),
    payload: { photoCount: 3 },
  };

  beforeAll(async () => {
    owner = ownerPool();
    await owner.query('TRUNCATE audit_log, attendance_sessions, users, tenants CASCADE');
    const t = await owner.query(
      `INSERT INTO tenants (name) VALUES ('Alpha Builders') RETURNING id`,
    );
    const tenantId = t.rows[0].id;
    const u = await owner.query(
      `INSERT INTO users (tenant_id, email, password_hash, role) VALUES
       ($1, 'eng@alpha.ph', 'x', 'engineer'),
       ($1, 'admin@alpha.ph', 'x', 'admin')
       RETURNING id, role, email`,
      [tenantId],
    );
    app = await createTestApp();
    const jwt = app.get(JwtService);
    engineerToken = jwt.sign({
      sub: u.rows[0].id,
      tenantId,
      email: u.rows[0].email,
      role: 'engineer',
    });
    adminToken = jwt.sign({
      sub: u.rows[1].id,
      tenantId,
      email: u.rows[1].email,
      role: 'admin',
    });
  });

  afterAll(async () => {
    await owner.query('TRUNCATE audit_log, attendance_sessions, users, tenants CASCADE');
    await owner.end();
    await app.close();
  });

  it('creates on first PUT and returns the identical result on retry', async () => {
    const uuid = randomUUID();
    const first = await request(app.getHttpServer())
      .put(`/sessions/${uuid}`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send(body)
      .expect(200);

    expect(first.body.id).toBe(uuid);
    expect(first.body.serverReceivedAt).toBeDefined();

    const second = await request(app.getHttpServer())
      .put(`/sessions/${uuid}`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send(body)
      .expect(200);

    expect(second.body).toEqual(first.body);

    const rows = await owner.query(
      'SELECT count(*)::int AS n FROM attendance_sessions WHERE id = $1',
      [uuid],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('writes exactly one audit entry per created session (E0-S05 helper in use)', async () => {
    const uuid = randomUUID();
    for (let i = 0; i < 2; i++) {
      await request(app.getHttpServer())
        .put(`/sessions/${uuid}`)
        .set('Authorization', `Bearer ${engineerToken}`)
        .send(body)
        .expect(200);
    }
    const audit = await owner.query(
      `SELECT count(*)::int AS n FROM audit_log WHERE entity = $1`,
      [`attendance_session:${uuid}`],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('stamps trusted time and computes clock drift (E0-S10)', async () => {
    const uuid = randomUUID();
    const skewedSentAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const res = await request(app.getHttpServer())
      .put(`/sessions/${uuid}`)
      .set('Authorization', `Bearer ${engineerToken}`)
      .send({ ...body, deviceSentAt: skewedSentAt })
      .expect(200);

    // Device clock 20 min behind → drift ≈ +1200 s.
    expect(res.body.clockDriftSeconds).toBeGreaterThan(1150);
    expect(res.body.clockDriftSeconds).toBeLessThan(1250);
    expect(res.body.deviceCapturedAt).toBe(body.deviceCapturedAt);
    expect(
      Math.abs(Date.parse(res.body.serverReceivedAt) - Date.now()),
    ).toBeLessThan(10_000);
  });

  it('rejects non-engineer roles', async () => {
    await request(app.getHttpServer())
      .put(`/sessions/${randomUUID()}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send(body)
      .expect(403);
  });

  it('audit_log is append-only for the app role', async () => {
    const appDb = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    await expect(
      appDb.query(`UPDATE audit_log SET reason = 'tampered'`),
    ).rejects.toThrow(/permission denied/);
    await expect(appDb.query(`DELETE FROM audit_log`)).rejects.toThrow(
      /permission denied/,
    );
    await appDb.end();
  });
});
